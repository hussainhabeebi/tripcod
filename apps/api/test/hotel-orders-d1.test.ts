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

test("My Trips lists hold, confirmed and cancelled hotels only for the authenticated tenant/account without supplier calls", async () => {
  const { Hono } = await import("hono");
  const { SignJWT } = await import("jose");
  const { hotelRoutes } = await import("../src/routes/hotel.js");
  await d1.exec("DELETE FROM hotel_bookings");
  const store = d1HotelOrderStore(d1);
  for (const status of ["ON_HOLD", "CONFIRMED", "CANCELLED"]) {
    await store.insert(row({ supplierBookingId: `MY-${status}`, status, mode: "HOLD", holdDeadline: "2026-11-20T18:00", hotel: { name: "Test Hotel", city: "Dubai", checkIn: "2026-11-25", checkOut: "2026-11-27", nights: 2 } }));
  }
  await store.insert(row({ supplierBookingId: "OTHER-USER", userId: "user-2" }));
  await store.insert(row({ supplierBookingId: "OTHER-TENANT", tenantId: "t2" }));
  await store.insert(row({ supplierBookingId: "GUEST", userId: null }));
  const secret = "isolated-test-secret";
  const token = (userId: string, tenantId = "t1", sessionId = "session-1") => new SignJWT({ userId, tenantId, role: "CUSTOMER", sessionId, scope: "customer-profile" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("5m").sign(new TextEncoder().encode(secret));
  const app = new Hono<any>();
  app.use("*", async (c, next) => { c.set("tenantId", "t1"); c.set("db", {}); await next(); });
  app.route("/api/hotels", hotelRoutes);
  const env = { JWT_SECRET: secret, HOTEL_DB: d1,
    SESSIONS_KV: { get: async (key: string) => key === "session:user-1" ? { sessionId: "session-1" } : null },
    TENANT_CACHE_KV: { get: async () => null },
  };
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = (async () => { externalCalls++; throw new Error("Unexpected external request"); }) as any;
  try {
    const get = (jwt?: string) => app.request("/api/hotels/orders/mine", { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} }, env, { waitUntil() {} } as any);
    const response = await get(await token("user-1"));
    assert.equal(response.status, 200);
    const { orders } = await response.json() as any;
    assert.deepEqual(orders.map((o: any) => o.status).sort(), ["CANCELLED", "CONFIRMED", "ON_HOLD"]);
    assert.ok(orders.every((o: any) => o.holdDeadline === "2026-11-20T18:00" && o.hotel.city === "Dubai" && o.supplierBookingId.startsWith("MY-")));
    for (const jwt of [undefined, await token("user-1", "t2"), await token("user-1", "t1", "ended-session"), await token("user-2")]) assert.equal((await get(jwt)).status, 401);
    assert.equal(externalCalls, 0, "listing never books, cancels, pays or refreshes at the supplier");
    assert.equal((await d1.prepare("SELECT COUNT(*) AS count FROM hotel_bookings").first()).count, 6);
  } finally { globalThis.fetch = originalFetch; }
});

test("Admin hotel listing and details read D1, retain every status and enforce tenant boundaries", async () => {
  const { Hono } = await import("hono");
  const { hotelBookingsAdminRoutes } = await import("../src/routes/admin/hotel-bookings.js");
  await d1.exec("DELETE FROM hotel_bookings");
  const store = d1HotelOrderStore(d1);
  const ids: string[] = [];
  for (const status of ["ON_HOLD", "CONFIRMED", "CANCELLED"]) ids.push((await store.insert(row({ supplierBookingId: `ADMIN-${status}`, status, mode: "HOLD", holdDeadline: "2026-11-20T18:00", cancellation: status === "CANCELLED" ? { charge: 100 } : null })))!.id);
  const other = (await store.insert(row({ supplierBookingId: "OTHER-TENANT", tenantId: "t2" })))!;
  const app = new Hono<any>();
  app.use("*", async (c, next) => { c.set("tenantId", "t1"); c.set("userRole", c.req.header("Test-Role") || "TENANT_ADMIN"); await next(); });
  app.route("/hotels", hotelBookingsAdminRoutes);
  const original = globalThis.fetch;
  let external = 0;
  globalThis.fetch = (async () => { external++; throw new Error("No external operations allowed"); }) as any;
  try {
    const get = (path: string, role?: string) => app.request(path, { headers: role ? { "Test-Role": role } : {} }, { HOTEL_DB: d1 });
    const result = await (await get("/hotels?tenantId=t2")).json() as any;
    assert.deepEqual(result.bookings.map((b:any)=>b.status).sort(), ["CANCELLED","CONFIRMED","ON_HOLD"]);
    assert.ok(result.bookings.every((b:any)=>b.tenantId === "t1" && !('accessKeyHash' in b)));
    const detail = await (await get(`/hotels/${ids[0]}`)).json() as any;
    assert.equal(detail.booking.holdDeadline,"2026-11-20T18:00");
    assert.equal(detail.booking.payment.status,"UNPAID");
    assert.equal((await get(`/hotels/${other.id}?tenantId=t2`)).status,404);
    assert.equal((await get(`/hotels/${other.id}`,"SUPER_ADMIN")).status,200);
    assert.equal((await (await get("/hotels?status=ON_HOLD&pnr=ADMIN-ON_HOLD")).json() as any).bookings.length,1);
    assert.equal((await (await get("/hotels?tenantId=t2","SUPER_ADMIN")).json() as any).bookings.length,1);
    assert.equal(external,0);
    assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM hotel_bookings").first()).n,4);
  } finally { globalThis.fetch=original; }
});
