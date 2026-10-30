// End-to-end flight payment flows against a real Postgres with every migration
// applied. Nomod and PhonePe are mocked at fetch(); no real payment is made.
// (Hotel orders live in D1: see hotel-orders.test.ts / hotel-orders-d1.test.ts.)
//
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres \
//     tsx --test test/payments-integration.test.ts
//
// Needs the `pg` driver (not a repo dependency): resolvable, or TEST_PG_MODULE=<path>. Skipped when
// TEST_DATABASE_URL is unset.

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

const DB_URL = process.env.TEST_DATABASE_URL;
const skip = !DB_URL && "TEST_DATABASE_URL not set";

let db: any, pool: any, schema: any, drizzleOrm: any;
let app: Hono<any>;
let env: any;
const queue: any[] = [];
const calls: { url: string; body: any }[] = [];
const sentRefunds: string[] = [];
const RUN = Date.now().toString(36);
const tenantId = `t-pay-${RUN}`;

// ── Gateway / supplier mocks ────────────────────────────────────────────────
const phonepeOrders = new Map<string, { state: string; amount: number }>();
const mock = { nomodRefund: "ok" as "ok" | "fail" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const realFetch = globalThis.fetch;
async function fakeFetch(input: any, init: any = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init.body === "string" ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : init.body;
  calls.push({ url, body });
  if (url.includes("/v1/oauth/token")) return json({ access_token: "tok", token_type: "O-Bearer", expires_at: Math.floor(Date.now() / 1000) + 3600 });
  if (url.endsWith("/checkout/v2/pay")) {
    phonepeOrders.set(body.merchantOrderId, { state: "PENDING", amount: body.amount });
    return json({ orderId: `OMO${body.merchantOrderId}`, state: "PENDING", expireAt: Date.now() + 1_200_000, redirectUrl: `https://mercury-uat.phonepe.com/pay/${body.merchantOrderId}` });
  }
  const st = /\/checkout\/v2\/order\/([^/]+)\/status/.exec(url);
  if (st) {
    const o = phonepeOrders.get(decodeURIComponent(st[1]));
    if (!o) return json({ code: "ORDER_NOT_FOUND" }, 404);
    return json({ orderId: `OMO${st[1]}`, state: o.state, amount: o.amount, paymentDetails: o.state === "COMPLETED" ? [{ transactionId: `TX${st[1]}`, paymentMode: "UPI_QR", state: "COMPLETED", amount: o.amount }] : [] });
  }
  if (url.endsWith("/payments/v2/refund")) { sentRefunds.push(body.merchantRefundId); return json({ refundId: `PR${body.merchantRefundId}`, amount: body.amount, state: "PENDING" }); }
  const rs = /\/payments\/v2\/refund\/([^/]+)\/status/.exec(url);
  if (rs) return json({ refundId: "x", state: "COMPLETED", amount: 100 });
  if (url === "https://api.nomod.com/v1/links") return json({ id: `lnk_${RUN}_${calls.length}`, url: `https://pay.nomod.com/l/${calls.length}`, amount: body.items[0].amount, currency: body.currency });
  if (url.includes("api.nomod.com/v1/charges/") && url.endsWith("/refund")) {
    sentRefunds.push(url);
    return mock.nomodRefund === "ok" ? json({ id: `rf_${sentRefunds.length}` }) : json({ message: "nope" }, 422);
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
}

function kv(seed: Record<string, unknown> = {}) {
  const m = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    m,
    get: async (k: string, t?: string) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
    put: async (k: string, v: string) => { m.set(k, v); },
    delete: async (k: string) => { m.delete(k); },
  };
}

const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const WEBHOOK_AUTH = () => sha256("ppuser:pppass");

async function svixHeaders(secret: string, body: string) {
  const id = `msg_${Math.random()}`, ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`, "content-type": "application/json" };
}

const ctx = { waitUntil(p: Promise<unknown>) { p.catch(() => {}); }, passThroughOnException() {} } as any;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.fetch(new Request(`http://x${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env, ctx);

async function newFlight(status = "PAYMENT_PENDING", total = "4999.50") {
  const [b] = await db.insert(schema.bookings).values({
    tenantId, channel: "B2C_WEB", status, tripType: "ONEWAY", origin: "DEL", destination: "BOM", departureDate: new Date(Date.now() + 864e5),
    flightData: {}, baseFare: "4000", taxes: "999.50", totalAmount: total, currency: "INR", supplier: "TRIPJACK",
  }).returning();
  return b;
}
const paymentRows = (bookingId: string) => db.select().from(schema.payments).where(drizzleOrm.eq(schema.payments.bookingId, bookingId));
const eventsFor = async (paymentId: string) => (await db.select().from(schema.paymentEvents).where(drizzleOrm.eq(schema.paymentEvents.paymentId, paymentId))).map((e: any) => e.event);

before(async () => {
  if (skip) return;
  const pg = await import(process.env.TEST_PG_MODULE ?? "pg");   // e.g. an absolute path to a local pg install
  const { drizzle } = await import("drizzle-orm/node-postgres");
  schema = await import("@tripcod/db/schema");
  drizzleOrm = await import("drizzle-orm");
  pool = new (pg.default ?? pg).Pool({ connectionString: DB_URL });
  db = drizzle(pool, { schema });
  await db.insert(schema.tenants).values({ id: tenantId, slug: tenantId, name: "Pay test" });

  globalThis.fetch = fakeFetch as typeof fetch;
  const nomodSecret = `whsec_${btoa("nomod-test-secret-0123456789")}`;
  env = {
    ENVIRONMENT: "production",
    NOMOD_API_KEY: "nomod_key", NOMOD_WEBHOOK_SECRET: nomodSecret, JWT_SECRET: "x".repeat(32),
    PHONEPE_UAT_CLIENT_ID: "uat_id", PHONEPE_UAT_CLIENT_SECRET: "uat_secret", PHONEPE_UAT_CLIENT_VERSION: "1",
    PHONEPE_UAT_WEBHOOK_USERNAME: "ppuser", PHONEPE_UAT_WEBHOOK_PASSWORD: "pppass",
    SESSIONS_KV: kv(), FARE_CACHE_KV: kv(),
    TENANT_CACHE_KV: kv({ [`admin_settings:${tenantId}:payments`]: { nomod: { enabled: true, apiKey: "nomod_key" }, phonepe: { enabled: true } } }),
    BOOKING_QUEUE: { send: async (m: unknown) => { queue.push(m); } },
  };

  const { paymentRoutes } = await import("../src/routes/payments.js");
  const { webhookRoutes } = await import("../src/routes/webhooks/index.js");
  const { paymentsAdminRoutes } = await import("../src/routes/admin/payments.js");
  const { checkoutRoutes } = await import("../src/routes/checkout.js");
  app = new Hono<any>();
  app.use("*", async (c, next) => { c.set("db", db); c.set("tenantId", tenantId); c.set("userRole", c.req.header("x-role") ?? "CUSTOMER"); await next(); });
  app.route("/api/payments", paymentRoutes);
  app.route("/api/checkout", checkoutRoutes);
  app.route("/webhooks", webhookRoutes);
  app.route("/api/admin/finance/payments", paymentsAdminRoutes);
  app.onError((err: any, c) => c.json({ error: err.message }, err.status ?? 500));
  (env as any).__nomodSecret = nomodSecret;
});

beforeEach(() => { queue.length = 0; mock.nomodRefund = "ok"; });

after(async () => {
  globalThis.fetch = realFetch;
  await pool?.end();
});

test("flight + PhonePe: one checkout, verified capture, idempotent webhook, no second charge", { skip }, async () => {
  const b = await newFlight();
  let res = await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" });
  assert.equal(res.status, 200, await res.clone().text());
  const first = await res.json() as any;
  assert.match(first.paymentUrl, /phonepe\.com/);
  const payBody = calls.find((c) => c.url.endsWith("/checkout/v2/pay"))!.body;
  assert.equal(payBody.amount, 499950, "amount sent in paise from the booking row");
  assert.ok(calls.some((c) => c.url.startsWith("https://api-preprod.phonepe.com/apis/pg-sandbox/")), "UAT host");

  // Double click: same open checkout comes back, nothing new created at PhonePe.
  res = await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" });
  const second = await res.json() as any;
  assert.equal(second.orderId, first.orderId);
  assert.equal(second.reused, true);
  assert.equal((await paymentRows(b.id)).length, 1);

  // Forged webhook rejected.
  res = await call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: first.orderId, state: "COMPLETED" } }, { Authorization: "deadbeef" });
  assert.equal(res.status, 401);

  // Webhook says completed, but PhonePe status API is still PENDING → nothing booked.
  res = await call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: first.orderId, state: "COMPLETED" } }, { Authorization: await WEBHOOK_AUTH() });
  assert.equal((await res.json() as any).outcome, "PENDING");
  assert.equal(queue.length, 0);

  phonepeOrders.get(first.orderId)!.state = "COMPLETED";
  res = await call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: first.orderId } }, { Authorization: await WEBHOOK_AUTH() });
  assert.equal((await res.json() as any).outcome, "CAPTURED");
  assert.equal(queue.length, 1);
  assert.deepEqual({ type: queue[0].type, orderId: queue[0].orderId }, { type: "PAYMENT_CAPTURED", orderId: first.orderId });
  const [p] = await paymentRows(b.id);
  assert.equal(p.status, "SUCCESS");
  assert.equal(p.environment, "UAT");
  assert.equal(p.gatewayPaymentId, `TX${first.orderId}`);

  // Re-delivered webhook: no second booking.
  await call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: first.orderId } }, { Authorization: await WEBHOOK_AUTH() });
  assert.equal(queue.length, 1);
  // Paid: a new checkout is refused.
  res = await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "NOMOD" });
  assert.equal(res.status, 409);
  const ledger = await eventsFor(p.id);
  for (const e of ["CHECKOUT_CREATED", "WEBHOOK", "CAPTURED"]) assert.ok(ledger.includes(e), `${e} in ledger`);
  queue.length = 0;
});

test("flight + PhonePe: amount mismatch is never booked", { skip }, async () => {
  const b = await newFlight();
  const r = await (await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" })).json() as any;
  phonepeOrders.set(r.orderId, { state: "COMPLETED", amount: 100 });   // ₹1 instead of ₹4999.50
  const res = await call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: r.orderId } }, { Authorization: await WEBHOOK_AUTH() });
  assert.equal((await res.json() as any).outcome, "AMOUNT_MISMATCH");
  assert.equal(queue.length, 0);
  const [p] = await paymentRows(b.id);
  assert.equal(p.status, "PENDING");
  assert.ok((await eventsFor(p.id)).includes("AMOUNT_MISMATCH"));
});

test("flight + PhonePe: failed order, then return page verifies a later success", { skip }, async () => {
  const b = await newFlight();
  const r = await (await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" })).json() as any;
  phonepeOrders.get(r.orderId)!.state = "FAILED";
  await call("POST", "/webhooks/phonepe", { event: "checkout.order.failed", payload: { merchantOrderId: r.orderId } }, { Authorization: await WEBHOOK_AUTH() });
  assert.equal((await paymentRows(b.id))[0].status, "FAILED");

  // Customer retries: a fresh order (the failed one isn't reused) completes; the
  // return page's poll confirms it with PhonePe without waiting for the webhook.
  const r2 = await (await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" })).json() as any;
  assert.notEqual(r2.orderId, r.orderId);
  phonepeOrders.get(r2.orderId)!.state = "COMPLETED";
  const view = await (await call("GET", `/api/payments/${b.id}`)).json() as any;
  assert.equal(view.payment.status, "SUCCESS");
  assert.equal(view.payment.gatewayOrderId, r2.orderId);
  assert.equal(queue.length, 1);
  queue.length = 0;
});

test("flight + Nomod: signed webhook captures; a second paid link is refunded as a duplicate", { skip }, async () => {
  const b = await newFlight("PAYMENT_PENDING", "1200.00");
  const r = await (await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "NOMOD" })).json() as any;
  const send = async (event: unknown) => {
    const raw = JSON.stringify(event);
    return call("POST", "/webhooks/nomod", raw, await svixHeaders(env.__nomodSecret, raw));
  };
  // Unsigned → rejected.
  assert.equal((await call("POST", "/webhooks/nomod", { type: "charge.completed" })).status, 400);
  let res = await send({ type: "charge.completed", data: { id: `chg_${RUN}_1`, link_id: r.orderId, amount: "1200.00", currency: "INR" } });
  assert.equal((await res.json() as any).outcome, "CAPTURED");
  assert.equal(queue.length, 1);

  // An older link for the same booking (opened in another tab before the fix) also gets paid.
  await db.insert(schema.payments).values({ bookingId: b.id, gateway: "NOMOD", gatewayOrderId: `lnk_old_${RUN}`, amount: "1200.00", currency: "INR", status: "PENDING" });
  res = await send({ type: "charge.completed", data: { id: `chg_${RUN}_2`, link_id: `lnk_old_${RUN}`, amount: "1200.00", currency: "INR" } });
  assert.equal((await res.json() as any).outcome, "DUPLICATE_CHARGE");
  assert.equal(queue.length, 1, "booked once");
  const rows = await paymentRows(b.id);
  const dup = rows.find((x: any) => x.gatewayOrderId === `lnk_old_${RUN}`);
  assert.equal(dup.status, "REFUNDED");
  assert.ok(sentRefunds.some((u) => u.includes(`/charges/chg_${RUN}_2/refund`)));
  assert.equal(rows.find((x: any) => x.gatewayOrderId === r.orderId).status, "SUCCESS");

  // Under-payment reported by Nomod is not booked.
  const b2 = await newFlight("PAYMENT_PENDING", "800.00");
  const r2 = await (await call("POST", "/api/payments/checkout", { bookingId: b2.id, gateway: "NOMOD" })).json() as any;
  res = await send({ type: "charge.completed", data: { id: `chg_${RUN}_3`, link_id: r2.orderId, amount: "8.00", currency: "INR" } });
  assert.equal((await res.json() as any).outcome, "AMOUNT_MISMATCH");
  assert.equal(queue.length, 1);
  queue.length = 0;
});

test("late payment for a cancelled booking is refunded, not booked", { skip }, async () => {
  const b = await newFlight();
  const r = await (await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" })).json() as any;
  await db.update(schema.bookings).set({ status: "CANCELLED" }).where(drizzleOrm.eq(schema.bookings.id, b.id));
  phonepeOrders.get(r.orderId)!.state = "COMPLETED";
  const res = await call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: r.orderId } }, { Authorization: await WEBHOOK_AUTH() });
  assert.equal((await res.json() as any).outcome, "LATE_PAYMENT");
  assert.equal(queue.length, 0);
  const [p] = await paymentRows(b.id);
  assert.equal(p.status, "REFUNDED");
  assert.ok(sentRefunds.includes(`RF_${r.orderId}_0`));
});

test("admin partial refund through PhonePe, one in flight at a time, webhook settles it", { skip }, async () => {
  const b = await newFlight("PAYMENT_PENDING", "1000.00");
  const r = await (await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" })).json() as any;
  phonepeOrders.get(r.orderId)!.state = "COMPLETED";
  await call("GET", `/api/payments/${b.id}`);
  queue.length = 0;
  const [p] = await paymentRows(b.id);
  const admin = { "x-role": "SUPER_ADMIN" };

  assert.equal((await call("POST", `/api/admin/finance/payments/${p.id}/refund`, { amount: 300, reason: "Goodwill" }, { "x-role": "STAFF" })).status, 403);
  assert.equal((await call("POST", `/api/admin/finance/payments/${p.id}/refund`, { amount: 5000, reason: "Too much" }, admin)).status, 400);
  let res = await call("POST", `/api/admin/finance/payments/${p.id}/refund`, { amount: 300, reason: "Goodwill" }, admin);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json() as any).pending, true);
  // Second refund while PhonePe still processes the first → refused.
  res = await call("POST", `/api/admin/finance/payments/${p.id}/refund`, { amount: 100, reason: "Again" }, admin);
  assert.equal(res.status, 409);

  let [row] = await paymentRows(b.id);
  assert.equal(row.status, "PARTIAL_REFUND");
  assert.equal(row.refundedAmount, "300.00");
  res = await call("POST", "/webhooks/phonepe", { event: "pg.refund.completed", payload: { merchantRefundId: `RF_${r.orderId}_0`, state: "COMPLETED" } }, { Authorization: await WEBHOOK_AUTH() });
  assert.equal(res.status, 200);
  [row] = await paymentRows(b.id);
  assert.ok(row.refundCompletedAt);
  // Now the rest can be refunded.
  res = await call("POST", `/api/admin/finance/payments/${p.id}/refund`, { reason: "Rest" }, admin);
  assert.equal(res.status, 200, await res.clone().text());
  [row] = await paymentRows(b.id);
  assert.equal(row.status, "REFUNDED");
  assert.equal(row.refundedAmount, "1000.00");
  assert.ok(sentRefunds.includes(`RF_${r.orderId}_30000`));

  const ledger = await (await call("GET", `/api/admin/finance/payments/events?paymentId=${p.id}`, undefined, admin)).json() as any;
  assert.ok(ledger.events.some((e: any) => e.event === "REFUND_COMPLETED"));
  const list = await (await call("GET", "/api/admin/finance/payments?gateway=PHONEPE&product=FLIGHT", undefined, admin)).json() as any;
  assert.ok(list.payments.some((x: any) => x.id === p.id && x.route === "DEL→BOM"));
});

test("PhonePe off in Admin → not offered, checkout refused", { skip }, async () => {
  const key = `admin_settings:${tenantId}:payments`;
  const saved = env.TENANT_CACHE_KV.m.get(key);
  env.TENANT_CACHE_KV.m.set(key, JSON.stringify({ nomod: { enabled: true, apiKey: "nomod_key" }, phonepe: { enabled: false } }));
  try {
    const opts = await (await call("GET", "/api/checkout/payment-options")).json() as any;
    assert.deepEqual(opts.gateways, { NOMOD: true, PHONEPE: false });
    const b = await newFlight();
    assert.equal((await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" })).status, 503);
  } finally {
    env.TENANT_CACHE_KV.m.set(key, saved);
  }
});

test("concurrent webhooks and racing charges book once", { skip }, async () => {
  // Same order notified 5 times at once.
  const b = await newFlight();
  const r = await (await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" })).json() as any;
  phonepeOrders.get(r.orderId)!.state = "COMPLETED";
  const auth = await WEBHOOK_AUTH();
  const outcomes = await Promise.all(Array.from({ length: 5 }, () =>
    call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: r.orderId } }, { Authorization: auth }).then((x) => x.json() as any)));
  assert.equal(outcomes.filter((o) => o.outcome === "CAPTURED").length, 1);
  assert.equal(queue.length, 1);

  // Two different charges for one booking completing at the same moment.
  queue.length = 0;
  const b2 = await newFlight("PAYMENT_PENDING", "700.00");
  const ids = [`TCF_RACE_A_${RUN}`, `TCF_RACE_B_${RUN}`];
  for (const id of ids) {
    await db.insert(schema.payments).values({ bookingId: b2.id, gateway: "PHONEPE", environment: "UAT", gatewayOrderId: id, amount: "700.00", currency: "INR", status: "PENDING" });
    phonepeOrders.set(id, { state: "COMPLETED", amount: 70000 });
  }
  const race = await Promise.all(ids.map((id) =>
    call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: id } }, { Authorization: auth }).then((x) => x.json() as any)));
  assert.deepEqual(race.map((o) => o.outcome).sort(), ["CAPTURED", "DUPLICATE_CHARGE"]);
  assert.equal(queue.length, 1);
  const rows = await paymentRows(b2.id);
  assert.deepEqual(rows.map((x: any) => x.status).sort(), ["REFUNDED", "SUCCESS"]);
});

test("a failed queue send undoes the capture so the webhook retry books it", { skip }, async () => {
  const b = await newFlight();
  const r = await (await call("POST", "/api/payments/checkout", { bookingId: b.id, gateway: "PHONEPE" })).json() as any;
  phonepeOrders.get(r.orderId)!.state = "COMPLETED";
  const send = env.BOOKING_QUEUE.send;
  env.BOOKING_QUEUE.send = async () => { throw new Error("queue unavailable"); };
  const auth = await WEBHOOK_AUTH();
  let res = await call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: r.orderId } }, { Authorization: auth });
  assert.equal(res.status, 500, "PhonePe will retry");
  assert.equal((await paymentRows(b.id))[0].status, "PENDING");
  env.BOOKING_QUEUE.send = send;
  res = await call("POST", "/webhooks/phonepe", { event: "checkout.order.completed", payload: { merchantOrderId: r.orderId } }, { Authorization: auth });
  assert.equal((await res.json() as any).outcome, "CAPTURED");
  assert.equal(queue.length, 1);
});
