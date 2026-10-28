// Hotel UAT certification logs: every TripJack Hotel v3 step is recorded with the
// IDs it carries, and Admin downloads one ZIP per TripJack booking.
// The real TripjackHotelV3Client runs against a mocked gateway; storage is in memory.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { TripjackHotelV3Client, type SupplierExchange } from "@tripcod/suppliers";
import { hotelExchangeLink, hotelScenario, hotelStep, persistHotelExchanges } from "../src/lib/hotel-cert-logs.js";
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

// Tiny fake of the drizzle calls used here: rows are matched by the literal
// values found inside the WHERE condition (exchange id, booking id or search ids).
function fakeDb() {
  const rows: any[] = [];
  const strings = (v: unknown, out = new Set<string>(), seen = new Set<unknown>(), depth = 0): Set<string> => {
    if (depth > 12 || v === null || v === undefined) return out;
    if (typeof v === "string") { out.add(v); return out; }
    if (typeof v !== "object" || seen.has(v)) return out;
    seen.add(v);
    for (const [k, child] of Object.entries(v as object)) if (k !== "table" && k !== "config") strings(child, out, seen, depth + 1);
    return out;
  };
  const db: any = {
    rows,
    insert: () => ({ values: async (v: any) => { rows.push({ id: `x${rows.length + 1}`, ...v }); } }),
    select: () => {
      let cond: unknown;
      const chain: any = {
        from: () => chain, where: (c: unknown) => { cond = c; return chain; }, orderBy: () => chain,
        limit: async () => {
          const s = strings(cond);
          const byId = rows.filter((r) => s.has(r.id));
          if (byId.length) return byId;
          const byBooking = rows.filter((r) => r.bookingId && s.has(r.bookingId));
          if (byBooking.length) return byBooking;
          const bySearch = rows.filter((r) => r.searchId && s.has(r.searchId));
          return bySearch.length ? bySearch : rows.slice().reverse();   // list query: newest first
        },
      };
      return chain;
    },
  };
  return db;
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

test("Admin downloads one certification ZIP per TripJack hotel booking", async () => {
  const exchanges = await recordedScenario();
  const r2 = new Map<string, string>();
  const env: any = {
    DOCUMENTS_R2: {
      put: async (k: string, v: string) => { r2.set(k, v); },
      get: async (k: string) => r2.has(k) ? { text: async () => r2.get(k)!, arrayBuffer: async () => new TextEncoder().encode(r2.get(k)!).buffer } : null,
    },
    TENANT_CACHE_KV: { get: async () => JSON.stringify({ environment: "UAT" }) },
  };
  const db = fakeDb();
  await persistHotelExchanges(env, db, "t1", exchanges, { requestId: "req-1" });
  assert.equal(db.rows.length, 8);
  assert.ok(db.rows.filter((r: any) => r.bookingId === TJ).length === 6, "review, book×2, details, confirm, cancel carry the booking ID");

  const app = new Hono<any>();
  app.use("*", async (c, n) => { c.set("tenantId", "t1"); c.set("db", db); await n(); });
  app.route("/logs", supplierLogsAdminRoutes);
  const res = await app.fetch(new Request(`http://x/logs/hotel-certification/${TJ}/zip`), env, { waitUntil() {}, passThroughOnException() {} } as any);
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

  const bad = await app.fetch(new Request("http://x/logs/hotel-certification/..%2Fetc/zip"), env, { waitUntil() {}, passThroughOnException() {} } as any);
  assert.equal(bad.status, 400);
});

test("Admin lists hotel bookings with the UAT steps logged for each", async () => {
  const r2 = new Map<string, string>();
  const env: any = {
    DOCUMENTS_R2: { put: async (k: string, v: string) => { r2.set(k, v); }, get: async (k: string) => r2.has(k) ? { text: async () => r2.get(k)! } : null },
    TENANT_CACHE_KV: { get: async () => null },
  };
  const db = fakeDb();
  await persistHotelExchanges(env, db, "t1", (await recordedScenario()).slice(0, 5), { requestId: "req-1" });   // search → review → hold → details
  const app = new Hono<any>();
  app.use("*", async (c, n) => { c.set("tenantId", "t1"); c.set("db", db); await n(); });
  app.route("/logs", supplierLogsAdminRoutes);
  const res = await app.fetch(new Request("http://x/logs/hotel-certification"), env, { waitUntil() {}, passThroughOnException() {} } as any);
  const { packs } = await res.json() as any;
  assert.equal(packs.length, 1);
  assert.equal(packs[0].bookingId, TJ);
  assert.equal(packs[0].scenario, "HOLD");
  assert.deepEqual(packs[0].covered, ["Search", "Review", "HoldBook", "BookingDetails"]);
  assert.deepEqual(packs[0].missing, []);
});
