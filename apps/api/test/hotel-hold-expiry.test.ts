// Hotel hold auto-cancellation, end to end on the real pieces: D1 store (local
// workerd SQLite with the production migration), TripJack client + exchange
// recorder against a mocked gateway, the cron sweep, the queue handler and the
// Admin UAT ZIP. The hold deadline is mocked in the past; nothing reaches TripJack.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { collectExchanges } from "../src/lib/api-exchanges.js";
import { persistHotelExchanges } from "../src/lib/hotel-cert-logs.js";
import { d1HotelOrderStore, hotelOrderDeps, processHoldExpiry, sweepExpiredHolds } from "../src/lib/hotel-order-store.js";
import { buildOrderRow, placeHold, publicOrder, sha256Hex } from "../src/lib/hotel-orders.js";
import { holdLifecycle, supplierLogsAdminRoutes } from "../src/routes/admin/supplier-logs.js";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('') } }", d1Databases: ["HOTEL_DB"] }));
const d1 = await mf.getD1Database("HOTEL_DB");
const migration = readFileSync(new URL("../d1-migrations/0001_hotel_bookings.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
await d1.batch(migration.split(";").map((q: string) => q.trim()).filter(Boolean).map((q: string) => d1.prepare(q)));
test.after(() => mf.dispose());

const TENANT = "t1";

function fakeR2() {
  const files = new Map<string, string>();
  return {
    files,
    put: async (k: string, v: string) => { files.set(k, v); },
    get: async (k: string) => files.has(k) ? { text: async () => files.get(k)!, arrayBuffer: async () => new TextEncoder().encode(files.get(k)!).buffer } : null,
    list: async ({ prefix, delimiter }: { prefix: string; delimiter?: string }) => {
      const keys = [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (!delimiter) return { objects: keys.map((key) => ({ key })), truncated: false };
      const prefixes = [...new Set(keys.map((k) => k.slice(prefix.length)).filter((r) => r.includes(delimiter)).map((r) => prefix + r.slice(0, r.indexOf(delimiter) + 1)))];
      return { objects: [], delimitedPrefixes: prefixes, truncated: false };
    },
  };
}

// Neon stand-in: supplier logs / exchange index inserts are kept; legacy lookups find nothing.
function fakeDb() {
  const inserted: any[] = [];
  // Index lookups by request key answer from the recorded exchange rows; legacy lookups find nothing.
  const rows = () => inserted.filter((v) => v.requestKey);
  const query: any = { orderBy: () => query, limit: async () => [], then: (ok: any, ko: any) => Promise.resolve(rows()).then(ok, ko), catch: () => Promise.resolve(rows()) };
  const chain: any = { from: () => chain, where: () => query };
  return { inserted, insert: () => ({ values: async (v: any) => { inserted.push(v); } }), select: () => chain };
}

function unzip(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 30 < bytes.length && view.getUint32(i, true) === 0x04034b50) {
    const size = view.getUint32(i + 18, true), nameLen = view.getUint16(i + 26, true), extra = view.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    out[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
    i = start + size;
  }
  return out;
}

// Mocked Tripcod gateway / TripJack: Booking Details answers `state.status`.
function gateway(tj: string, deadline: string) {
  const state = { status: "ON_HOLD", details: 0, other: [] as string[] };
  globalThis.fetch = (async (url: string, init: any) => {
    const path = new URL(url).pathname;
    let body: unknown = { status: { success: true } };
    if (path === "/oms/v3/hotel/book") body = { bookingId: tj, status: { success: true } };
    else if (path === "/oms/v3/hotel/booking-details") {
      state.details++;
      body = { order: { bookingId: tj, status: state.status, amount: 30000 }, itemInfos: { HOTEL: { hInfo: { name: "Test Hotel", ops: [{ ddt: deadline }] } } }, status: { success: true } };
    } else state.other.push(`${init.method} ${path}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
  return state;
}

function environment() {
  const r2 = fakeR2();
  const queued: any[] = [];
  const env: any = {
    HOTEL_DB: d1, DOCUMENTS_R2: r2,
    TENANT_CACHE_KV: { get: async (_k: string, t?: string) => { const v = { hotelApiKey: "uat-hotel-key", hotelEnvironment: "UAT", environment: "PRODUCTION", apiKey: "prod-flight-key" }; return t === "json" ? v : JSON.stringify(v); } },
    TRIPJACK_API_BASE_URL: "https://gateway.test", TRIPJACK_PROXY_KEY: "gw-secret",
    BOOKING_QUEUE: { send: async (m: any) => { queued.push(m); }, sendBatch: async (ms: any[]) => { queued.push(...ms.map((m) => m.body)); } },
  };
  return { env, r2, queued };
}

// Hold placed the way the website does it (recorded into the booking's UAT folder).
async function placeRecordedHold(env: any, db: any, tj: string) {
  const store = d1HotelOrderStore(d1, TENANT);
  const order = (await store.insert(buildOrderRow({
    review: { tenantId: TENANT, bookingId: tj, hid: "100000038374", correlationId: "corr12345678",
      hotel: { hid: "100000038374", name: "Test Hotel", address: "MG Road", city: "Kochi", countryCode: "IN", stars: 4, checkIn: "2026-11-30", checkOut: "2026-12-02", nights: 2 },
      occupancy: [{ adults: 2, childAges: [] }], nationality: "IN", currency: "INR", onholdAllowed: true, reviewedAt: "2026-10-28T00:00:00Z",
      option: { optionId: "o1", optionType: "SRSM", roomInfo: [{ id: "r", name: "King" }], inclusions: [], mealBasis: "RO",
        pricing: { totalPrice: 30000, basePrice: 26000, discount: 0, taxes: 4000, mf: 0, mft: 0, currency: "INR" }, commercial: { type: "NET", commission: 0 },
        compliance: { gstType: "", panRequired: false, passportRequired: false }, cancellation: { isRefundable: true, penalties: [] } } as any,
    },
    mode: "HOLD", userId: "user-1", guests: [[{ title: "Mr", firstName: "Arun", lastName: "Guest", type: "ADULT" }]],
    contactEmail: "a@b.co", contactPhone: "9876543210", dialCode: "91", accessKeyHash: await sha256Hex("k"),
  })))!;
  const collector = collectExchanges();
  const held = await placeHold(await hotelOrderDeps(env, db, TENANT, { recorder: collector.recorder, pollMs: 0 }), order);
  await persistHotelExchanges(env, db, TENANT, collector.exchanges, { bookingId: tj, requestId: "req-hold" });
  // The hold was placed (and its status read) a day before the mocked deadline.
  await d1.prepare("UPDATE hotel_bookings SET last_checked_at = ?, supplier_submitted_at = ? WHERE id = ?")
    .bind(new Date(Date.parse(held.holdDeadline!) - 86400_000).toISOString(), new Date(Date.parse(held.holdDeadline!) - 86400_000).toISOString(), held.id).run();
  return held;
}

function adminZip(env: any, db: any, tj: string) {
  const app = new Hono<any>();
  app.use("*", async (c, n) => { c.set("tenantId", TENANT); c.set("db", db); await n(); });
  app.route("/logs", supplierLogsAdminRoutes);
  return app.fetch(new Request(`http://x/logs/hotel-certification/${tj}/zip`), env, { waitUntil() {}, passThroughOnException() {} } as any);
}

test("Test Case 1: expired hold → sweep → one verified Booking Details check → CANCELLED, with ON_HOLD + CANCELLED evidence in the ZIP", async () => {
  await d1.exec("DELETE FROM hotel_bookings");
  const TJ = "TJP202803274047";
  const deadline = new Date(Date.now() - 2 * 3600_000).toISOString();   // two hours ago
  const { env, r2, queued } = environment();
  const db = fakeDb();
  const tj = gateway(TJ, deadline);

  const held = await placeRecordedHold(env, db, TJ);
  assert.equal(held.status, "ON_HOLD");
  assert.equal(held.holdDeadline, deadline);

  // TripJack has released the hold. The cron sweep queues it once.
  tj.status = "CANCELLED";
  const detailsBefore = tj.details;
  assert.deepEqual(await sweepExpiredHolds(env), { queued: 1 });
  assert.deepEqual(queued, [{ type: "HOTEL_HOLD_EXPIRY_CHECK", hotelBookingId: held.id, tenantId: TENANT }]);

  // Delivered twice (at-least-once queue) — TripJack is asked once.
  const [a, b] = await Promise.all([processHoldExpiry(env, db as any, queued[0]), processHoldExpiry(env, db as any, queued[0])]);
  assert.equal([a, b].filter((r) => r.checked).length, 1);
  assert.equal(tj.details, detailsBefore + 1);
  assert.deepEqual(tj.other, [], "no cancel-booking or other call: TripJack cancelled it, we only read the status");

  const order = (await d1HotelOrderStore(d1, TENANT).get(held.id))!;
  assert.equal(order.status, "CANCELLED");
  assert.equal(order.supplierStatus, "CANCELLED");
  assert.equal(order.paymentStatus, "UNPAID");
  assert.equal(publicOrder(order).status, "CANCELLED");
  assert.deepEqual(await sweepExpiredHolds(env), { queued: 0 }, "nothing left to check");

  // Original request / response stored with the booking.
  const responses = [...r2.files.entries()].filter(([k]) => k.startsWith(`api-logs/${TENANT}/booking-${TJ}/`) && k.includes("booking-details-response"));
  assert.ok(responses.some(([, v]) => JSON.parse(v).order.status === "CANCELLED"), "CANCELLED Booking Details response stored");
  assert.ok(responses.some(([, v]) => JSON.parse(v).order.status === "ON_HOLD"), "ON_HOLD Booking Details response stored");

  // Admin → Hotel UAT logs → Download ZIP.
  const res = await adminZip(env, db, TJ);
  assert.equal(res.status, 200);
  const files = unzip(new Uint8Array(await res.arrayBuffer()));
  const summary = JSON.parse(files["HotelBookingSummary.json"]);
  assert.equal(summary.holdLifecycle.outcome, "CANCELLED_BY_TRIPJACK_AFTER_HOLD_DEADLINE");
  assert.ok(summary.holdLifecycle.onHold && summary.holdLifecycle.cancelled);
  for (const name of [...summary.holdLifecycle.onHold.files, ...summary.holdLifecycle.cancelled.files]) assert.ok(files[name], `${name} is in the ZIP`);
  const cancelledResponse = summary.holdLifecycle.cancelled.files.find((f: string) => f.endsWith("Response.json"));
  assert.equal(JSON.parse(files[cancelledResponse]).order.status, "CANCELLED", "byte-for-byte TripJack response");
  assert.equal(summary.tripcodOrder.status, "CANCELLED");
  assert.ok(files["HotelHoldBookRequest.json"], "the hold request is in the pack");
  assert.ok(!JSON.stringify(files).includes("gw-secret"), "gateway secret never in the pack");
});

test("expired hold that TripJack still reports ON_HOLD stays ON_HOLD (deadline alone never cancels)", async () => {
  await d1.exec("DELETE FROM hotel_bookings");
  const TJ = "TJP202803274099";
  const { env, queued } = environment();
  const db = fakeDb();
  gateway(TJ, new Date(Date.now() - 3600_000).toISOString());
  const held = await placeRecordedHold(env, db, TJ);
  await sweepExpiredHolds(env);
  const r = await processHoldExpiry(env, db as any, queued[0]);
  assert.equal(r.checked, true);
  assert.equal(r.order!.status, "ON_HOLD");
  assert.deepEqual(await sweepExpiredHolds(env), { queued: 0 }, "re-checked only after the 10-minute interval");
  assert.equal((await d1HotelOrderStore(d1, TENANT).get(held.id))!.status, "ON_HOLD");
});

test("hold lifecycle summary: requested cancellation and open holds are labelled distinctly", () => {
  const book = { step: "HoldBook", files: ["HotelHoldBookRequest.json"], at: "1" };
  const det = (s: string, n: number) => ({ step: "BookingDetails", files: [`HotelBookingDetail_${n}Response.json`], at: String(n), supplierStatus: s });
  assert.equal(holdLifecycle([{ step: "InstantBook", files: [], at: "1" }]), null);
  assert.equal(holdLifecycle([book, det("ON_HOLD", 2)])!.outcome, "ON_HOLD");
  assert.equal(holdLifecycle([book, det("ON_HOLD", 2), { step: "Cancellation", files: [], at: "3" }, det("CANCELLED", 4)])!.outcome, "CANCELLED_ON_REQUEST");
  assert.equal(holdLifecycle([book, det("ON_HOLD", 2), det("CANCELLED", 3)])!.outcome, "CANCELLED_BY_TRIPJACK_AFTER_HOLD_DEADLINE");
});

test("Admin hotel booking API logs: chronological calls with status, duration, TripJack status, masked API key, named JSON files", async () => {
  await d1.exec("DELETE FROM hotel_bookings");
  const TJ = "TJP202803274050";
  const { env, queued } = environment();
  const db = fakeDb();
  const tj = gateway(TJ, new Date(Date.now() - 2 * 3600_000).toISOString());
  const held = await placeRecordedHold(env, db, TJ);
  tj.status = "CANCELLED";
  await sweepExpiredHolds(env);
  await processHoldExpiry(env, db as any, queued[0]);

  const { hotelBookingsAdminRoutes } = await import("../src/routes/admin/hotel-bookings.js");
  const app = new Hono<any>();
  app.use("*", async (c, n) => { c.set("tenantId", TENANT); c.set("userRole", "TENANT_ADMIN"); c.set("db", db); await n(); });
  app.route("/hotels", hotelBookingsAdminRoutes);
  const get = (path: string) => app.fetch(new Request(`http://x/hotels/${held.id}${path}`), env, { waitUntil() {}, passThroughOnException() {} } as any);

  const logs = await (await get("/exchanges")).json() as any;
  const labels = logs.exchanges.map((x: any) => x.label);
  assert.deepEqual(labels, ["Hold", "Booking Details", "Booking Details"], "oldest first");
  assert.ok(logs.exchanges.every((x: any) => x.httpStatus === 200 && x.ok && typeof x.durationMs === "number" && x.hasResponse));
  assert.deepEqual(logs.exchanges.filter((x: any) => x.step === "BookingDetails").map((x: any) => x.supplierStatus), ["ON_HOLD", "CANCELLED"]);
  assert.ok(logs.exchanges.every((x: any) => x.requestId), "request IDs shown");
  assert.equal(logs.certification.scenario, "HOLD");
  assert.ok(logs.certification.covered.includes("HoldBook") && logs.certification.missing.includes("Search"));
  assert.equal(logs.certification.holdLifecycle.outcome, "CANCELLED_BY_TRIPJACK_AFTER_HOLD_DEADLINE");

  const request = await get("/exchanges/0/request");
  assert.equal(request.headers.get("Content-Disposition"), `attachment; filename="${TJ}-01-HotelHoldBookRequest.json"`);
  const requestText = await request.text();
  assert.ok(!requestText.includes("uat-hotel-key") && JSON.parse(requestText).headers.apikey.startsWith("uat-"), "API key masked in the Admin view");
  assert.ok(!requestText.includes("gw-secret"));
  const response = await get("/exchanges/2/response");
  assert.equal(response.headers.get("Content-Disposition"), `attachment; filename="${TJ}-03-HotelBookingDetailResponse.json"`);
  assert.equal(JSON.parse(await response.text()).order.status, "CANCELLED", "response exactly as stored");

  // The certification ZIP keeps the exact request (API key included) for TripJack.
  const files = unzip(new Uint8Array(await (await adminZip(env, db, TJ)).arrayBuffer()));
  assert.equal(JSON.parse(files["HotelHoldBookRequest.json"]).headers.apikey, "uat-hotel-key");
});

test("supplier error messages are read from stored TripJack responses", async () => {
  const { describeHotelResponse } = await import("../src/lib/hotel-cert-logs.js");
  assert.deepEqual(describeHotelResponse("Search", 403, JSON.stringify({ error: { code: "403", message: "Invalid API key" } })),
    { ok: false, supplierStatus: null, supplierError: "Invalid API key", errorCode: "403" });
  assert.equal(describeHotelResponse("Review", 200, JSON.stringify({ status: { success: false, statusMessage: "Option sold out" }, errors: [{ errCode: "6506", message: "Option sold out" }] })).errorCode, "6506");
  assert.equal(describeHotelResponse("BookingDetails", 200, JSON.stringify({ order: { status: "UNCONFIRMED" }, status: { success: true } })).supplierStatus, "UNCONFIRMED");
  assert.equal(describeHotelResponse("Search", 502, "<html>Bad gateway</html>").ok, false);
});
