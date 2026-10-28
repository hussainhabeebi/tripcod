// Same hotel UAT scenarios as hotel-orders.test.ts, on the Cloudflare D1 store
// (local workerd SQLite via Miniflare, d1-migrations applied). Plus D1-only checks.
import test from "node:test";
import assert from "node:assert/strict";
process.env.HOTEL_STORE = "d1";
await import("./hotel-orders.test.js");
const { createRequire } = await import("node:module");
const { readFileSync } = await import("node:fs");
const { d1HotelOrderStore } = await import("../src/lib/hotel-order-store.js");
const { claimPayment, reconcileWalletPayment, refreshOrder } = await import("../src/lib/hotel-orders.js");

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('') } }", d1Databases: ["HOTEL_DB"] }));
const d1 = await mf.getD1Database("HOTEL_DB");
const migration = readFileSync(new URL("../d1-migrations/0001_hotel_bookings.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
await d1.batch(migration.split(";").map((q: string) => q.trim()).filter(Boolean).map((q: string) => d1.prepare(q)));
test.after(() => mf.dispose());

const row = (over: Record<string, unknown> = {}) => ({
  tenantId: "t1", userId: "user-1", supplierBookingId: "TJH-D1-1", mode: "INSTANT", status: "PAYMENT_PENDING",
  hotel: { name: "Hotel ₹ \"quoted\"", checkIn: "2026-11-30" }, occupancy: [{ adults: 2, childAges: [4, 9] }], guests: [[{ firstName: "A" }]],
  option: { pricing: { totalPrice: 30000 }, cancellation: { isRefundable: true, penalties: [] } }, nationality: "IN",
  amount: "30000.00", currency: "INR" as const, contactEmail: "a@b.co", contactPhone: "9876543210", dialCode: "+91", accessKeyHash: "h", ...over,
});

test("D1 migration: table, constraints and indexes as the code expects", async () => {
  const cols = await d1.prepare("SELECT name FROM pragma_table_info('hotel_bookings')").all();
  assert.equal(cols.results.length, 35);
  const idx = await d1.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'hotel_bookings' AND name LIKE 'hotel_%'").all();
  assert.equal(idx.results.length, 3);
  await assert.rejects(d1.prepare("INSERT INTO hotel_bookings (id, tenant_id, supplier_booking_id, mode, status, hotel, occupancy, guests, option, nationality, amount, currency, contact_email, contact_phone, dial_code, access_key_hash, created_at, updated_at) VALUES ('x','t','b','BOGUS','S','{}','[]','[]','{}','IN','1','INR','e','p','+91','h','n','n')").run());
});

test("D1 store: JSON / dates / money round-trip, one order per TripJack booking, tenant scoping", async () => {
  await d1.exec("DELETE FROM hotel_bookings");
  const store = d1HotelOrderStore(d1);
  const created = (await store.insert(row()))!;
  assert.deepEqual(created.occupancy, [{ adults: 2, childAges: [4, 9] }]);
  assert.equal((created.hotel as any).name, "Hotel ₹ \"quoted\"");
  assert.ok(created.createdAt instanceof Date);
  assert.equal(created.paymentStatus, "UNPAID");
  assert.equal(Number(created.amount), 30000);
  assert.equal(await store.insert(row()), null, "same TripJack booking → no second order");
  assert.equal(await d1HotelOrderStore(d1, "other-tenant").get(created.id), null, "tenant-scoped store can't read another tenant's order");
  const updated = (await store.update(created.id, { paidAt: new Date("2026-11-01T00:00:00Z"), cancellation: { charge: 0 } }))!;
  assert.equal(updated.paidAt?.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.deepEqual(updated.cancellation, { charge: 0 });
  assert.equal((await store.listByUser("t1", "user-1")).length, 1);
});

test("D1 store: concurrent payment claims — exactly one wins", async () => {
  await d1.exec("DELETE FROM hotel_bookings");
  const store = d1HotelOrderStore(d1);
  const order = (await store.insert(row({ supplierBookingId: "TJH-D1-2" })))!;
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => claimPayment(store, order, n % 2 ? "NOMOD" : "WALLET", `ref-${n}`)));
  assert.equal(results.filter(Boolean).length, 1);
  const claims = await Promise.all([1, 2, 3].map(() => store.update(order.id, { supplierSubmittedAt: new Date() }, { supplierSubmittedAtNull: true })));
  assert.equal(claims.filter(Boolean).length, 1, "TripJack book is claimed once");
  assert.ok(await store.byPaymentOrder([results.find(Boolean)!.paymentOrderId!]));
});

// Cross-database: order in D1, wallet ledger in Neon.
for (const [label, debited, expected] of [["debited in Neon", true, "PAID"], ["never debited", false, "UNPAID"]] as const) {
  test(`wallet payment interrupted after the D1 claim (${label}) is settled from the Neon ledger`, async () => {
    await d1.exec("DELETE FROM hotel_bookings");
    const store = d1HotelOrderStore(d1);
    const order = (await store.insert(row({ supplierBookingId: `TJH-W-${label}` })))!;
    const slot = (await claimPayment(store, order, "WALLET", "hotel_wallet_x_1"))!;
    let clock = Date.now();
    const queued: string[] = []; const asked: string[] = [];
    const deps: any = { store, enqueue: async (id: string) => { queued.push(id); }, now: () => clock,
      walletDebited: async (ref: string) => { asked.push(ref); return debited; } };
    assert.equal((await reconcileWalletPayment(deps, slot)).paymentStatus, "PENDING", "too recent — the paying request may still run");
    clock += 61_000;
    const settled = await refreshOrder(deps, slot);
    assert.deepEqual(asked, ["hotel_wallet_x_1"]);
    assert.equal(settled.paymentStatus, expected);
    assert.deepEqual(queued, debited ? [order.id] : []);
  });
}
