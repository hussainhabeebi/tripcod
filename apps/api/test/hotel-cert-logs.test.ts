// Hotel UAT certification logs: every TripJack Hotel v3 step is recorded with the
// IDs it carries, and Admin downloads one ZIP per TripJack booking.
// The real TripjackHotelV3Client runs against a mocked gateway; storage is in memory.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { TripjackHotelV3Client, type SupplierExchange } from "@tripcod/suppliers";
import { hotelExchangeLink, hotelScenario, hotelStep, persistHotelExchanges } from "../src/lib/hotel-cert-logs.js";
import { persistExchanges } from "../src/lib/api-exchanges.js";
import { supplierLogsAdminRoutes } from "../src/routes/admin/supplier-logs.js";

const SEARCH = "corr0123456789abcdef";
const TJ = "TJH900100200300";

// Mocked TripJack gateway: canned JSON per path.
const RESPONSES: Record<string, unknown> = {
  "/hms/v3/hotel/listing": { hotels: [{ hotelId: "100000038374", name: "Test", options: [] }] },
  "/hms/v3/hotel/pricing": { tjHotelId: "100000038374", hotelName: "Test", options: [], reviewHash: "rh" },
  "/hms/v3/hotel/review": { bookingId: TJ, tjHotelId: "100000038374", hotelName: "Test", option: {}, onholdAllowed: "true" },
  "/oms/v3/hotel/book": { bookingId: TJ, status: { success: true } },
  "/oms/v3/hotel/confirm-book": { bookingId: TJ, status: { success: true } },
  "/oms/v3/hotel/booking-details": { order: { bookingId: TJ, status: "ON_HOLD" }, status: { success: true } },
  [`/oms/v3/hotel/cancel-booking/${TJ}`]: { status: { success: true } },
};

async function recordedScenario(): Promise<SupplierExchange[]> {
  const exchanges: SupplierExchange[] = [];
  const client = new TripjackHotelV3Client({ baseUrl: "https://gateway.test", apiKey: "uat-key", proxyKey: "gw-secret", recorder: (x: SupplierExchange) => exchanges.push(x) } as any);
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = new URL(url).pathname;
    return new Response(JSON.stringify(RESPONSES[path] ?? {}), { status: 200, headers: { "content-type": "application/json", "x-request-id": "gw-1" } });
  }) as any;
  try {
    const rooms = [{ adults: 2, children: 1, childAge: [6] }, { adults: 1 }];
    const stay = { checkIn: "2026-11-30", checkOut: "2026-12-02", rooms, currency: "INR", nationality: "106" };
    await client.listing({ ...stay, correlationId: SEARCH, hids: ["100000038374"] });
    await client.pricing({ ...stay, correlationId: SEARCH, hid: "100000038374" });
    await client.review({ correlationId: SEARCH, optionId: "opt-1", reviewHash: "rh", hid: "100000038374" });
    const traveller = { roomTravellerInfo: [{ travellerInfo: [{ ti: "Mr", pt: "ADULT" as const, fN: "Arun", lN: "Kumar" }] }],
      deliveryInfo: { emails: ["a@b.co"], contacts: ["9876543210"], code: ["+91"] } };
    await client.book({ bookingId: TJ, ...traveller });                                         // hold: no paymentInfos
    await client.bookingDetails(TJ);
    await client.confirmBook(TJ, 16598);
    await client.book({ bookingId: TJ, ...traveller, paymentInfos: [{ amount: 16598 }] });     // instant shape
    await client.cancel(TJ);
  } finally {
    globalThis.fetch = original;
  }
  return exchanges;
}

test("each hotel call is linked to the TripJack booking / search IDs it carries", async () => {
  const x = await recordedScenario();
  const links = x.map((e) => [e.endpoint, hotelExchangeLink(e)]);
  assert.deepEqual(links, [
    ["/hms/v3/hotel/listing", { bookingId: null, searchId: SEARCH }],
    ["/hms/v3/hotel/pricing", { bookingId: null, searchId: SEARCH }],
    ["/hms/v3/hotel/review", { bookingId: TJ, searchId: SEARCH }],          // booking ID from the Review response
    ["/oms/v3/hotel/book", { bookingId: TJ, searchId: null }],
    ["/oms/v3/hotel/booking-details", { bookingId: TJ, searchId: null }],
    ["/oms/v3/hotel/confirm-book", { bookingId: TJ, searchId: null }],
    ["/oms/v3/hotel/book", { bookingId: TJ, searchId: null }],
    [`/oms/v3/hotel/cancel-booking/${TJ}`, { bookingId: TJ, searchId: null }],   // booking ID from the URL
  ]);
});

test("steps are named for TripJack and hold vs instant is read from paymentInfos", () => {
  assert.deepEqual(hotelStep("/oms/v3/hotel/book", { bookingId: TJ }), { step: "HoldBook", name: "HotelHoldBook" });
  assert.deepEqual(hotelStep("/oms/v3/hotel/book", { paymentInfos: [{ amount: 1 }] }), { step: "InstantBook", name: "HotelBook" });
  assert.deepEqual(hotelStep(`/oms/v3/hotel/cancel-booking/${TJ}`, null), { step: "Cancellation", name: "HotelCancelBooking" });
  assert.equal(hotelScenario(new Set(["Search", "Review", "HoldBook", "ConfirmHold", "BookingDetails"])).scenario, "HOLD_THEN_CONFIRM");
  assert.deepEqual(hotelScenario(new Set(["Search", "Review", "InstantBook"])).missing, ["BookingDetails"]);
  assert.equal(hotelScenario(new Set(["Search", "Review", "HoldBook", "BookingDetails", "Cancellation"])).scenario, "HOLD_CANCELLED");
});

// ── Storage + Admin ZIP ─────────────────────────────────────────────────────

// Production constraint: supplier_exchanges.booking_id REFERENCES bookings(id)
// (flight bookings). Any other non-null booking_id is rejected like Postgres would.
function fakeDb(flightBookingIds: string[] = []) {
  const rows: any[] = [];
  const db: any = {
    rows, rejected: 0,
    insert: () => ({ values: async (v: any) => {
      if (v.requestKey && v.bookingId && !flightBookingIds.includes(v.bookingId)) {
        db.rejected++;
        throw new Error('insert or update on table "supplier_exchanges" violates foreign key constraint "supplier_exchanges_booking_id_fkey"');
      }
      if (v.requestKey) rows.push({ id: `x${rows.length + 1}`, ...v, startedAt: v.startedAt });
    } }),
    // Only the legacy Review lookup queries Neon now: newest Review rows first.
    select: () => {
      let cond: unknown;
      const chain: any = { from: () => chain, where: (c: unknown) => { cond = c; return chain; }, orderBy: () => chain,
        // Legacy lookups (Review, then listing) — the fake answers by the endpoint in the WHERE clause.
    limit: async () => { const e = JSON.stringify(cond ?? null, (_k, v) => typeof v === "object" && v && ("table" in v) ? undefined : v);
      const wanted = /hotel\/listing/.test(e) ? "/hms/v3/hotel/listing" : "/hms/v3/hotel/review";
      return rows.filter((r) => r.endpoint === wanted).reverse(); } };
      return chain;
    },
  };
  return db;
}

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

function adminApp(db: any) {
  const app = new Hono<any>();
  app.use("*", async (c, n) => { c.set("tenantId", "t1"); c.set("db", db); await n(); });
  app.route("/logs", supplierLogsAdminRoutes);
  return (path: string, env: any) => app.fetch(new Request(`http://x/logs${path}`), env, { waitUntil() {}, passThroughOnException() {} } as any);
}

test("hotel calls are stored and indexed despite the flight-only booking_id constraint", async () => {
  const r2 = fakeR2();
  const db = fakeDb();
  await persistHotelExchanges({ DOCUMENTS_R2: r2 } as any, db, "t1", await recordedScenario(), { requestId: "req-1" });
  assert.equal(db.rejected, 0, "no index insert hits the foreign key");
  assert.equal(db.rows.length, 8, "every call has an index row");
  assert.ok(db.rows.every((r: any) => r.bookingId === null));
  const bookingFiles = [...r2.files.keys()].filter((k) => k.startsWith(`api-logs/t1/booking-${TJ}/`));
  assert.equal(bookingFiles.length, 12, "review, hold, details, confirm, book, cancel: request + response in the booking folder");
});

test("Admin downloads one certification ZIP per TripJack hotel booking", async () => {
  const r2 = fakeR2();
  const env: any = { DOCUMENTS_R2: r2, TENANT_CACHE_KV: { get: async () => JSON.stringify({ environment: "UAT" }) } };
  const db = fakeDb();
  await persistHotelExchanges(env, db, "t1", await recordedScenario(), { requestId: "req-1" });

  const res = await adminApp(db)(`/hotel-certification/${TJ}/zip`, env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Disposition") ?? "", new RegExp(`tripjack-hotel-${TJ}.zip`));
  const files = unzip(new Uint8Array(await res.arrayBuffer()));
  const names = Object.keys(files);
  for (const n of ["HotelSearch", "HotelDetail", "HotelReview", "HotelHoldBook", "HotelBookingDetail", "HotelConfirmBook", "HotelBook", "HotelCancelBooking"]) {
    assert.ok(names.includes(`${n}Request.json`) && names.includes(`${n}Response.json`), `${n} request + response`);
  }
  assert.ok(names.includes("HotelBookingSummary.json"));

  // Request as TripJack received it: TripJack UAT host + apikey, never the gateway secret.
  const req = JSON.parse(files["HotelHoldBookRequest.json"]);
  assert.match(req.url, /^https:\/\/apitest-hotel-booker\.tripjack\.com\/oms\/v3\/hotel\/book$/);
  assert.equal(req.headers.apikey, "uat-key");
  assert.doesNotMatch(JSON.stringify(req), /gw-secret|x-tripcod-gateway-key/i);
  assert.equal(req.body.bookingId, TJ);
  assert.equal(req.body.paymentInfos, undefined);
  assert.match(JSON.parse(files["HotelSearchRequest.json"]).url, /^https:\/\/apitest-hms\.tripjack\.com\/hms\/v3\/hotel\/listing$/);
  assert.deepEqual(JSON.parse(files["HotelSearchRequest.json"]).body.rooms, [{ adults: 2, children: 1, childAge: [6] }, { adults: 1 }]);
  assert.match(JSON.parse(files["HotelCancelBookingRequest.json"]).url, new RegExp(`/oms/v3/hotel/cancel-booking/${TJ}$`));
  // Responses are byte-for-byte what TripJack returned.
  assert.equal(files["HotelReviewResponse.json"], JSON.stringify(RESPONSES["/hms/v3/hotel/review"]));

  const summary = JSON.parse(files["HotelBookingSummary.json"]);
  assert.equal(summary.tripjackBookingId, TJ);
  assert.deepEqual(summary.correlationIds, [SEARCH]);
  assert.equal(summary.scenario, "HOLD_THEN_CONFIRM_CANCELLED");
  assert.deepEqual(summary.missing, []);
  assert.deepEqual(summary.covered, ["Search", "Review", "InstantBook", "HoldBook", "ConfirmHold", "BookingDetails", "Cancellation"]);

  const { packs } = await (await adminApp(db)("/hotel-certification", env)).json() as any;
  assert.equal(packs.length, 1);
  assert.equal(packs[0].bookingId, TJ);
  assert.equal(packs[0].scenario, "HOLD_THEN_CONFIRM_CANCELLED");
  assert.equal(packs[0].searchAndReviewFromSearchLogs, false);
  assert.deepEqual(packs[0].missing, []);

  assert.equal((await adminApp(db)("/hotel-certification/..%2Fetc/zip", env)).status, 400);
  assert.equal((await adminApp(db)("/hotel-certification/TJNOTHING1/zip", env)).status, 404);
});

test("a hold logged before this fix (index rejected, Review in the search folder) still gets its full pack", async () => {
  // Production state of TJP202803274047: search / review indexed by correlationId only;
  // hold book + details written to R2 under booking-<id> but their index rows rejected.
  const r2 = fakeR2();
  const env: any = { DOCUMENTS_R2: r2, TENANT_CACHE_KV: { get: async () => null } };
  const db = fakeDb();
  const x = await recordedScenario();
  // Before PR #15 the listing sat in the browser request's folder (no correlationId link).
  await persistExchanges(env, db, "t1", x.slice(0, 1), { requestId: "hotel-old-search-request" });
  await persistExchanges(env, db, "t1", x.slice(1, 3), { searchId: SEARCH, requestId: "old-detail" });
  await persistExchanges(env, db, "t1", x.slice(3, 5), { bookingId: TJ, requestId: "old-order" }).catch(() => {});
  assert.equal(db.rejected, 2, "same rejection production saw");

  const { packs } = await (await adminApp(db)("/hotel-certification", env)).json() as any;
  assert.equal(packs.length, 1);
  assert.equal(packs[0].bookingId, TJ);
  assert.equal(packs[0].scenario, "HOLD");
  // The fast list reads the booking folder only; the ZIP below recovers Search + Review.
  assert.deepEqual(packs[0].covered, ["HoldBook", "BookingDetails"]);
  assert.equal(packs[0].searchAndReviewFromSearchLogs, true);
  assert.deepEqual(packs[0].missing, []);

  const files = unzip(new Uint8Array(await (await adminApp(db)(`/hotel-certification/${TJ}/zip`, env)).arrayBuffer()));
  for (const n of ["HotelSearch", "HotelDetail", "HotelReview", "HotelHoldBook", "HotelBookingDetail"]) {
    assert.ok(files[`${n}Request.json`] && files[`${n}Response.json`], `${n} recovered`);
  }
  assert.equal(JSON.parse(files["HotelHoldBookRequest.json"]).body.bookingId, TJ);
});
