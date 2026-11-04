// Hotel wallet payment, end to end through the real hotel routes:
// signed-in customer (real JWT + session) → order in D1 (local workerd SQLite) →
// wallet debit → queue → TripJack book (mocked gateway) → refund on failure /
// automatic wallet refund after a supplier-confirmed cancellation.
//
// The customer wallet (Neon) is the flight wallet module's contract run in memory:
// a debit succeeds only when the balance covers it, atomically, with a ledger row.
// Run with --experimental-test-module-mocks.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";

// ── In-memory customer wallet (same rules as lib/customer-wallet.ts) ─────────
type Tx = { walletId: string; type: string; amount: number; balanceAfter: number; bookingId?: string; paymentId?: string; note?: string };
const wallets = new Map<string, { id: string; userId: string; balance: number }>();
const ledger: Tx[] = [];
const round = (n: number) => Math.round(n * 100) / 100;
const walletModule = {
  CUSTOMER_WALLET_CURRENCY: "INR", BOOKING_BONUS_AMOUNT: 50, COUPON_TTL_DAYS: 30, COUPON_MIN_AMOUNT: 10,
  roundMoney: round,
  async getOrCreateCustomerWallet(_db: unknown, _tenant: string, userId: string) {
    if (!wallets.has(userId)) wallets.set(userId, { id: `w-${userId}`, userId, balance: 0 });
    const w = wallets.get(userId)!;
    return { id: w.id, balance: w.balance.toFixed(2), currency: "INR" };
  },
  async debitWallet(_db: unknown, walletId: string, amount: number, type: string, meta: Partial<Tx> = {}) {
    await new Promise((r) => setTimeout(r, 1));   // let concurrent payers interleave
    const w = [...wallets.values()].find((x) => x.id === walletId)!;
    if (w.balance < round(amount)) return null;      // conditional UPDATE … WHERE balance >= amount
    w.balance = round(w.balance - amount);
    ledger.push({ walletId, type, amount: round(amount), balanceAfter: w.balance, ...meta });
    return w.balance;
  },
  async creditWallet(_db: unknown, walletId: string, amount: number, type: string, meta: Partial<Tx> = {}) {
    const w = [...wallets.values()].find((x) => x.id === walletId)!;
    w.balance = round(w.balance + amount);
    ledger.push({ walletId, type, amount: round(amount), balanceAfter: w.balance, ...meta });
    return w.balance;
  },
  creditBookingBonus: async () => false, expireOverdueCoupons: async () => {}, generateCouponCode: () => "X",
};
mock.module(new URL("../src/lib/customer-wallet.ts", import.meta.url).href, { namedExports: walletModule });

const { hotelRoutes } = await import("../src/routes/hotel.js");
const { processHotelPayment } = await import("../src/lib/hotel-order-store.js");
const { Hono } = await import("hono");

// ── Environment: D1, KV, queue, R2, Neon (wallet ledger lookups), TripJack gateway ──
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('') } }", d1Databases: ["HOTEL_DB"] }));
const d1 = await mf.getD1Database("HOTEL_DB");
const migration = readFileSync(new URL("../d1-migrations/0001_hotel_bookings.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
await d1.batch(migration.split(";").map((q: string) => q.trim()).filter(Boolean).map((q: string) => d1.prepare(q)));
test.after(() => mf.dispose());

const TENANT = "t1";
const kv = new Map<string, string>();
const queue: any[] = [];
const env: any = {
  JWT_SECRET: "test-secret", TRIPJACK_API_BASE_URL: "https://gw.test", TRIPJACK_API_KEY: "uat-key",
  HOTEL_DB: d1, BOOKING_QUEUE: { send: async (m: unknown) => { queue.push(m); } },
  SESSIONS_KV: { get: async (k: string, t?: string) => kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)!) : kv.get(k)) : null, put: async (k: string, v: string) => { kv.set(k, v); } },
  TENANT_CACHE_KV: { get: async () => null }, FARE_CACHE_KV: { get: async () => null, put: async () => {} },
  DOCUMENTS_R2: { put: async () => {} },
};
// Neon: supplier logs are accepted; wallet ledger lookups by payment_id read the in-memory ledger.
const db: any = {
  insert: () => ({ values: async () => {} }),
  select: () => {
    let cond: unknown;
    const chain: any = { from: () => chain, where: (c: unknown) => { cond = c; return chain; }, orderBy: () => chain,
      limit: async () => { const s = JSON.stringify(cond ?? null, (_k, v) => typeof v === "object" && v && "table" in v ? undefined : v);
        return ledger.filter((t) => t.paymentId && s.includes(`"${t.paymentId}"`)).map(() => ({ id: "tx" })); } };
    return chain;
  },
};

// TripJack gateway: book / confirm / cancel accepted; Booking Details answers from `supplier`.
let supplier = "SUCCESS";
const tripjackCalls: string[] = [];
globalThis.fetch = (async (url: string) => {
  const path = new URL(url).pathname;
  tripjackCalls.push(path);
  if (path.includes("/cancel-booking/")) supplier = "CANCELLED";   // TripJack cancels when asked
  const body = path.endsWith("booking-details")
    ? { order: { bookingId: "x", status: supplier }, hotelConfirmationNumber: supplier === "SUCCESS" ? "HCN-1" : undefined, itemInfos: { HOTEL: { hInfo: { ops: [{}] } } } }
    : { status: { success: true } };
  return new Response(JSON.stringify(body), { status: 200 });
}) as any;

const app = new Hono<any>();
app.use("*", async (c, n) => { c.set("tenantId", TENANT); c.set("db", db); await n(); });
app.route("/h", hotelRoutes);
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
async function call(path: string, opts: { method?: string; body?: unknown; token?: string; key?: string } = {}) {
  const res = await app.fetch(new Request(`http://x/h${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.key ? { "X-Hotel-Order-Key": opts.key } : {}) },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  }), env, ctx);
  return { status: res.status, body: await res.json() as any };
}

async function signIn(userId: string) {
  const sessionId = crypto.randomUUID();
  kv.set(`session:${userId}`, JSON.stringify({ userId, tenantId: TENANT, role: "CUSTOMER", sessionId }));
  return new SignJWT({ userId, tenantId: TENANT, role: "CUSTOMER", sessionId }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.JWT_SECRET));
}

let n = 0;
// A reviewed room (server-side snapshot, as /review stores it), free cancellation until next year.
function reviewed(currency = "INR", total = 30000) {
  const bookingId = `TJW${Date.now()}${++n}`;
  kv.set(`hotel_review:${TENANT}:${bookingId}`, JSON.stringify({
    tenantId: TENANT, bookingId, hid: "1", correlationId: "corr1234567",
    hotel: { hid: "1", name: "Wallet Test Hotel", address: "", city: "Kochi", countryCode: "IN", stars: 4, checkIn: "2027-03-10", checkOut: "2027-03-12", nights: 2 },
    occupancy: [{ adults: 1, childAges: [] }], nationality: "AE", currency, onholdAllowed: true, reviewedAt: "",
    option: { optionId: "o", optionType: "", roomInfo: [{ id: "r", name: "Deluxe" }], inclusions: [], mealBasis: "", commercial: { type: "", commission: 0 },
      pricing: { totalPrice: total, basePrice: total, discount: 0, taxes: 0, mf: 0, mft: 0, currency },
      compliance: { gstType: "NA", panRequired: false, passportRequired: false },
      cancellation: { isRefundable: true, penalties: [{ from: "2020-01-01T00:00", to: "2027-03-01T00:00", amount: 0 }, { from: "2027-03-01T00:00", to: "2027-03-10T12:00", amount: 9000 }] } },
  }));
  return bookingId;
}
const order = (bookingId: string, token?: string) => call("/orders", { token, body: {
  bookingId, mode: "INSTANT", contactEmail: "c@x.co", contactPhone: "9876543210", dialCode: "+91",
  rooms: [{ guests: [{ title: "Mr", firstName: "Wallet", lastName: "Tester", type: "ADULT" }] }] } });
const balance = (userId: string) => wallets.get(userId)?.balance ?? 0;
const debits = (orderId: string) => ledger.filter((t) => t.type === "BOOKING_DEBIT" && t.bookingId === orderId);

test("wallet payment: offered only when it covers the INR total; a short balance charges nothing", async () => {
  const token = await signIn("u1");
  const { body } = await order(reviewed(), token);
  const id = body.order.id;
  await walletModule.getOrCreateCustomerWallet(db, TENANT, "u1");
  wallets.get("u1")!.balance = 100;
  let opts = await call(`/orders/${id}/payment-options`, { token });
  assert.equal(opts.body.wallet.available, false);
  assert.match(opts.body.wallet.reason, /doesn't cover/);
  const short = await call(`/orders/${id}/pay`, { token, body: { method: "WALLET" } });
  assert.equal(short.status, 402);
  assert.equal(short.body.errorCode, "WALLET_INSUFFICIENT");
  assert.equal(balance("u1"), 100);
  assert.equal(debits(id).length, 0);
  const after = await call(`/orders/${id}`, { token });
  assert.equal(after.body.order.payment.status, "UNPAID", "slot released — card or wallet can be tried again");
  wallets.get("u1")!.balance = 50000;
  opts = await call(`/orders/${id}/payment-options`, { token });
  assert.equal(opts.body.wallet.available, true);
  assert.equal(opts.body.wallet.balance, 50000);
});

test("wallet payment: one debit even with simultaneous clicks; booked with TripJack only after payment", async () => {
  const token = await signIn("u2");
  const { body } = await order(reviewed(), token);
  const id = body.order.id;
  await walletModule.getOrCreateCustomerWallet(db, TENANT, "u2");
  wallets.get("u2")!.balance = 50000;
  tripjackCalls.length = 0; queue.length = 0;
  const results = await Promise.all([1, 2, 3].map(() => call(`/orders/${id}/pay`, { token, body: { method: "WALLET" } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal(debits(id).length, 1);
  assert.equal(balance("u2"), 20000);
  assert.equal(tripjackCalls.filter((p) => p.endsWith("/book")).length, 0, "nothing booked at payment time");
  assert.equal(queue.length, 1);
  const paid = results.find((r) => r.status === 200)!.body.order;
  assert.equal(paid.payment.status, "PAID");
  assert.notEqual(paid.status, "CONFIRMED", "payment alone never confirms");
  assert.equal((await call(`/orders/${id}/pay`, { token, body: { method: "WALLET" } })).status, 409, "already paid");

  supplier = "SUCCESS";
  await processHotelPayment(env, db, queue[0]);
  const done = await call(`/orders/${id}`, { token });
  assert.equal(done.body.order.status, "CONFIRMED");
  assert.equal(tripjackCalls.filter((p) => p.endsWith("/book")).length, 1);
  await processHotelPayment(env, db, queue[0]);   // queue retry
  assert.equal(tripjackCalls.filter((p) => p.endsWith("/book")).length, 1, "no second booking");
});

test("wallet payment: a booking TripJack fails is refunded to the wallet once", async () => {
  const token = await signIn("u3");
  const { body } = await order(reviewed(), token);
  const id = body.order.id;
  await walletModule.getOrCreateCustomerWallet(db, TENANT, "u3");
  wallets.get("u3")!.balance = 30000;
  queue.length = 0;
  assert.equal((await call(`/orders/${id}/pay`, { token, body: { method: "WALLET" } })).status, 200);
  assert.equal(balance("u3"), 0);
  supplier = "FAILED";
  await processHotelPayment(env, db, queue[0]);
  await processHotelPayment(env, db, queue[0]);
  const after = await call(`/orders/${id}`, { token });
  assert.equal(after.body.order.status, "FAILED");
  assert.equal(after.body.order.payment.status, "REFUNDED");
  assert.equal(balance("u3"), 30000);
  assert.equal(ledger.filter((t) => t.type === "REFUND_CREDIT" && t.bookingId === id).length, 1);
});

test("wallet payment: cancelling a confirmed booking refunds the policy amount to the wallet automatically", async () => {
  const token = await signIn("u4");
  const { body } = await order(reviewed(), token);
  const id = body.order.id;
  await walletModule.getOrCreateCustomerWallet(db, TENANT, "u4");
  wallets.get("u4")!.balance = 30000;
  queue.length = 0;
  await call(`/orders/${id}/pay`, { token, body: { method: "WALLET" } });
  supplier = "SUCCESS";
  await processHotelPayment(env, db, queue[0]);
  const quote = await call(`/orders/${id}/cancel-quote`, { token });
  assert.equal(quote.body.quote.charge, 0);
  assert.equal(quote.body.quote.refund, 30000);
  const cancelled = await call(`/orders/${id}/cancel`, { token, body: { confirm: true, expectedCharge: 0 } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body).slice(0, 300));
  assert.equal(cancelled.body.order.status, "CANCELLED");
  assert.equal(cancelled.body.order.payment.status, "REFUNDED");
  assert.equal(cancelled.body.order.payment.refundAmount, 30000);
  assert.equal(balance("u4"), 30000);
  await call(`/orders/${id}?refresh=1`, { token });   // later refreshes don't credit again
  assert.equal(ledger.filter((t) => t.type === "REFUND_CREDIT" && t.bookingId === id).length, 1);
});

test("wallet payment: only the customer who booked, only INR", async () => {
  const owner = await signIn("u5");
  const other = await signIn("u6");
  const { body } = await order(reviewed(), owner);
  assert.equal((await call(`/orders/${body.order.id}/pay`, { token: other, body: { method: "WALLET" } })).status, 404, "another customer can't see it");
  const guest = await order(reviewed());   // booked without signing in
  const viaKey = await call(`/orders/${guest.body.order.id}/pay`, { key: guest.body.key, token: owner, body: { method: "WALLET" } });
  assert.equal(viaKey.status, 403);
  assert.equal(viaKey.body.errorCode, "WALLET_SIGN_IN");
  const aed = await order(reviewed("AED", 1500), owner);
  const res = await call(`/orders/${aed.body.order.id}/pay`, { token: owner, body: { method: "WALLET" } });
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, "WALLET_CURRENCY");
});

test("wallet payment interrupted between the D1 claim and the Neon debit is settled from the ledger", async () => {
  const token = await signIn("u7");
  const { body } = await order(reviewed(), token);
  const id = body.order.id;
  await walletModule.getOrCreateCustomerWallet(db, TENANT, "u7");
  wallets.get("u7")!.balance = 30000;
  // The paying request claimed the slot and debited Neon, then died before marking PAID.
  const ref = `hotel_wallet_${id}_1`;
  await d1.prepare("UPDATE hotel_bookings SET payment_status = 'PENDING', payment_gateway = 'WALLET', payment_order_id = ?, updated_at = ? WHERE id = ?")
    .bind(ref, new Date(Date.now() - 120_000).toISOString(), id).run();
  await walletModule.debitWallet(db, "w-u7", 30000, "BOOKING_DEBIT", { bookingId: id, paymentId: ref });
  queue.length = 0;
  const after = await call(`/orders/${id}`, { token });
  assert.equal(after.body.order.payment.status, "PAID");
  assert.equal(queue.length, 1, "queued for TripJack");
  assert.equal(debits(id).length, 1);
});
