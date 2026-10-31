// Hotel booking UAT flows against a mocked TripJack Hotel API v3 client and an
// in-memory order store. No supplier, payment or database call leaves the process.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  decodeOccupancy, encodeOccupancy, guestErrors, occupancyErrors, toTripjackRooms, cancellationChargeAt, leadPanRequired,
  type HotelGuestInput, type HotelV3Option, type RoomOccupancy,
} from "@tripcod/suppliers";
import {
  buildOrderRow, canAccess, checkExpiredHold, holdCheckDue, cancelOrder, cancelQuote, claimPayment, payable, placeHold, processPaidOrder, publicOrder,
  recordPaid, refreshOrder, sha256Hex, type HotelOrder, type HotelOrderDeps, type HotelOrderStore, type ReviewSnapshot,
} from "../src/lib/hotel-orders.js";
import { hotelRoutes } from "../src/routes/hotel.js";
import { d1HotelOrderStore } from "../src/lib/hotel-order-store.js";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { after } from "node:test";

// HOTEL_STORE=d1 (hotel-orders-d1.test.ts) runs every scenario against the real
// D1 store on local workerd SQLite with the production D1 migration applied.
const USE_D1 = process.env.HOTEL_STORE === "d1";
async function localD1() {
  const require = createRequire(import.meta.url);
  const wrangler = createRequire(require.resolve("wrangler/package.json"));
  const { Miniflare, convertV4MiniflareOptions } = wrangler("miniflare");
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('') } }", d1Databases: ["HOTEL_DB"] }));
  const d1 = await mf.getD1Database("HOTEL_DB");
  const sql = readFileSync(new URL("../d1-migrations/0001_hotel_bookings.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  await d1.batch(sql.split(";").map((q: string) => q.trim()).filter(Boolean).map((q: string) => d1.prepare(q)));
  after(() => mf.dispose());
  return d1;
}
const D1 = USE_D1 ? await localD1() : null;

// A fresh, empty store per test (memory, or the D1 table emptied first).
function newStore(): HotelOrderStore {
  if (!D1) return memoryStore();
  const ready = D1.exec("DELETE FROM hotel_bookings");
  const store = d1HotelOrderStore(D1);
  return Object.fromEntries(Object.entries(store).map(([k, fn]) => [k, async (...a: unknown[]) => { await ready; return (fn as any)(...a); }])) as HotelOrderStore;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const UAT_ROOMS: RoomOccupancy[] = [
  { adults: 2, childAges: [4, 9] },   // Room 1: 2 adults, 2 children
  { adults: 3, childAges: [7] },      // Room 2: 3 adults, 1 child
  { adults: 2, childAges: [1] },      // Room 3: 2 adults, 1 child
];

function option(over: Partial<HotelV3Option> = {}): HotelV3Option {
  return {
    optionId: "opt-1", optionType: "CRCM", roomInfo: [{ id: "r1", name: "Deluxe" }], inclusions: [], mealBasis: "Room Only",
    pricing: { totalPrice: 30000, basePrice: 26000, discount: 0, taxes: 3600, mf: 300, mft: 100, currency: "INR" },
    commercial: { type: "NET", commission: 0 },
    compliance: { gstType: "NA", panRequired: false, passportRequired: false },
    cancellation: {
      isRefundable: true,
      penalties: [
        { from: "2026-01-01T00:00", to: "2026-11-20T23:59", amount: 0 },
        { from: "2026-11-21T00:00", to: "2026-11-30T12:00", amount: 12000 },
      ],
      deadlineDateTime: "2026-11-20T23:59",
    },
    ...over,
  };
}

function review(over: Partial<ReviewSnapshot> = {}): ReviewSnapshot {
  return {
    tenantId: "t1", bookingId: "TJH100200300", hid: "100000038374", correlationId: "corr12345678",
    hotel: { hid: "100000038374", name: "Test Hotel", address: "MG Road", city: "Kochi", countryCode: "IN", stars: 4, checkIn: "2026-11-30", checkOut: "2026-12-02", nights: 2 },
    occupancy: UAT_ROOMS, nationality: "IN", currency: "INR", option: option(), onholdAllowed: true, reviewedAt: "2026-10-28T00:00:00Z",
    ...over,
  };
}

const adult = (fN: string, extra: Partial<HotelGuestInput> = {}): HotelGuestInput => ({ title: "Mr", firstName: fN, lastName: "Guest", type: "ADULT", ...extra });
const child = (fN: string): HotelGuestInput => ({ title: "Master", firstName: fN, lastName: "Guest", type: "CHILD" });
const UAT_GUESTS: HotelGuestInput[][] = [
  [adult("Arun"), adult("Bina", { title: "Ms" }), child("Cian"), child("Dev")],
  [adult("Esha", { title: "Ms" }), adult("Farid"), adult("Gopal"), child("Hari")],
  [adult("Ivan"), adult("Jaya", { title: "Mrs" }), child("Kiran")],
];

function memoryStore(): HotelOrderStore & { rows: Map<string, HotelOrder> } {
  const rows = new Map<string, HotelOrder>();
  let n = 0;
  const pass = (o: HotelOrder, g: any = {}) => (!g.status || g.status.includes(o.status))
    && (!g.paymentStatus || g.paymentStatus.includes(o.paymentStatus))
    && (!g.supplierSubmittedAtNull || !o.supplierSubmittedAt) && (!g.confirmSubmittedAtNull || !o.confirmSubmittedAt)
    && (!("lastCheckedAt" in g) || (o.lastCheckedAt?.getTime() ?? null) === (g.lastCheckedAt?.getTime() ?? null));
  return {
    rows,
    async insert(row) {
      if ([...rows.values()].some((o) => o.tenantId === row.tenantId && o.supplierBookingId === row.supplierBookingId)) return null;
      const o = {
        id: `order-${++n}`, userId: null, supplierStatus: null, confirmationNo: null, holdDeadline: null,
        paymentStatus: "UNPAID", paymentGateway: null, paymentOrderId: null, paymentRef: null, paymentUrl: null, paidAt: null,
        refundAmount: null, refundNote: null, supplierSubmittedAt: null, confirmSubmittedAt: null, cancellation: null,
        lastError: null, lastCheckedAt: null, createdAt: new Date(), updatedAt: new Date(), ...row,
      } as HotelOrder;
      rows.set(o.id, o);
      return { ...o };
    },
    async get(id) { const o = rows.get(id); return o ? { ...o } : null; },
    async bySupplierBooking(t, b) { const o = [...rows.values()].find((x) => x.tenantId === t && x.supplierBookingId === b); return o ? { ...o } : null; },
    async byPaymentOrder(ids) { const o = [...rows.values()].find((x) => x.paymentOrderId && ids.includes(x.paymentOrderId)); return o ? { ...o } : null; },
    async listByUser(t, u) { return [...rows.values()].filter((x) => x.tenantId === t && x.userId === u); },
    async update(id, patch, guard) {
      const o = rows.get(id);
      if (!o || !pass(o, guard)) return null;
      Object.assign(o, patch, { updatedAt: new Date() });
      return { ...o };
    },
  };
}

// Scripted TripJack: booking-details answers come from `statuses` (last one repeats).
function tripjack(statuses: string[], opts: { bookError?: any; confirmError?: any; cancelError?: any; deadline?: string } = {}) {
  const calls: { book: any[]; confirm: any[]; cancel: string[]; details: number } = { book: [], confirm: [], cancel: [], details: 0 };
  let i = 0;
  const client = {
    async book(req: any) { calls.book.push(req); if (opts.bookError) throw opts.bookError; return { bookingId: req.bookingId, status: { success: true } }; },
    async confirmBook(bookingId: string, amount: number) { calls.confirm.push({ bookingId, amount }); if (opts.confirmError) throw opts.confirmError; return { status: { success: true } }; },
    async cancel(bookingId: string) { calls.cancel.push(bookingId); if (opts.cancelError) throw opts.cancelError; return { status: { success: true } }; },
    async bookingDetails(bookingId: string) {
      calls.details++;
      const status = statuses[Math.min(i++, statuses.length - 1)];
      return {
        order: { bookingId, status, amount: 30000 },
        hotelConfirmationNumber: status === "SUCCESS" ? "HCN-778" : undefined,
        itemInfos: { HOTEL: { hInfo: { name: "Test Hotel", ops: [{ ddt: opts.deadline ?? "2026-11-25T18:00" }] } } },
      };
    },
  };
  return { client, calls, setStatuses: (s: string[]) => { statuses = s; i = 0; } };
}

// The clock moves only when the code under test sleeps between Booking Details polls.
function deps(store: HotelOrderStore, client: any, start = "2026-11-01T10:00:00+05:30") {
  const refunds: { amount: number; reason: string }[] = [];
  const queued: string[] = [];
  let clock = Date.parse(start);
  const d: HotelOrderDeps = {
    store, client, call: (_e, _s, fn) => fn(),
    refund: async (_o, amount, reason) => { refunds.push({ amount, reason }); return { ok: true, note: "refunded" }; },
    enqueue: async (id) => { queued.push(id); },
    now: () => clock, sleep: async (ms) => { clock += ms; }, pollMs: 60_000,
  };
  return { d, refunds, queued };
}

async function newOrder(store: HotelOrderStore, mode: "INSTANT" | "HOLD", r = review()) {
  return (await store.insert(buildOrderRow({
    review: r, mode, userId: "user-1", guests: UAT_GUESTS, contactEmail: "a@b.co", contactPhone: "+91 98765 43210", dialCode: "91",
    accessKeyHash: await sha256Hex("secret-key"),
  })))!;
}

async function pay(d: HotelOrderDeps, order: HotelOrder) {
  const slot = await claimPayment(d.store, order, "NOMOD", "link-1");
  assert.ok(slot, "payment slot claimed");
  return (await recordPaid(d, slot!, "charge-1"))!;
}

// ── 1/2: children + room-wise occupancy ─────────────────────────────────────

test("room-wise occupancy with children maps to TripJack rooms and survives the URL", () => {
  assert.deepEqual(occupancyErrors(UAT_ROOMS), []);
  assert.deepEqual(toTripjackRooms(UAT_ROOMS), [
    { adults: 2, children: 2, childAge: [4, 9] }, { adults: 3, children: 1, childAge: [7] }, { adults: 2, children: 1, childAge: [1] },
  ]);
  assert.deepEqual(toTripjackRooms([{ adults: 1, childAges: [] }]), [{ adults: 1 }]);
  const encoded = encodeOccupancy(UAT_ROOMS);
  assert.equal(encoded, "2_4_9-3_7-2_1");
  assert.deepEqual(decodeOccupancy(encoded), UAT_ROOMS);
  assert.equal(decodeOccupancy("0"), null);               // no adult
  assert.equal(decodeOccupancy("2_1_2_3_4_5"), null);     // 5 children
  assert.equal(decodeOccupancy("2_18"), null);            // not a child age
  assert.equal(decodeOccupancy("1-1-1-1-1-1-1-1-1-1"), null);   // 10 rooms
  assert.ok(occupancyErrors([{ adults: 2, childAges: [Number.NaN] }]).length);
});

test("search/review reject a child without an age before calling TripJack", async () => {
  const app = new Hono<any>();
  app.use("*", async (c, n) => { c.set("tenantId", "t"); c.set("db", { insert: () => ({ values: async () => {} }) }); await n(); });
  app.route("/h", hotelRoutes);
  const res = await app.fetch(new Request("http://x/h/search", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cityCode: "COK", checkIn: "2026-11-30", checkOut: "2026-12-02", rooms: [{ adults: 2, children: 2, childAge: [5] }], nationality: "IN", currency: "INR" }) }),
    {}, { waitUntil: (p: any) => p, passThroughOnException() {} } as any);
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as any).error, /childAge/);
});

test("guests must match each room's adults and children; PAN only for eligible Indian guests", () => {
  const rules = { nationality: "IN", hotelCountryCode: "IN", panRequired: false, passportRequired: false };
  assert.deepEqual(guestErrors(UAT_ROOMS, UAT_GUESTS, rules), []);
  const missingChild = UAT_GUESTS.map((r, i) => i === 1 ? r.slice(0, 3) : r);
  assert.match(guestErrors(UAT_ROOMS, missingChild, rules)[0], /Room 2 needs 3 adults, 1 child/);
  assert.match(guestErrors(UAT_ROOMS, UAT_GUESTS, { ...rules, panRequired: true }).join(), /lead guest's PAN/);
  assert.match(guestErrors(UAT_ROOMS, UAT_GUESTS, { ...rules, hotelCountryCode: "AE" }).join(), /lead guest's PAN/);   // international stay
  assert.equal(leadPanRequired({ ...rules, nationality: "AE", panRequired: true }), false);                            // foreign guests: no PAN
  const withPan = UAT_GUESTS.map((r, i) => i === 0 ? [{ ...r[0], pan: "ABCDE1234F" }, ...r.slice(1)] : r);
  assert.deepEqual(guestErrors(UAT_ROOMS, withPan, { ...rules, panRequired: true }), []);
  const badPan = UAT_GUESTS.map((r, i) => i === 0 ? [{ ...r[0], pan: "12345" }, ...r.slice(1)] : r);
  assert.match(guestErrors(UAT_ROOMS, badPan, rules).join(), /ABCDE1234F/);
  const childFirst = UAT_GUESTS.map((r, i) => i === 2 ? [r[2], r[0], r[1]] : r);
  assert.match(guestErrors(UAT_ROOMS, childFirst, rules).join(), /first guest must be an adult/);
});

// ── Instant booking (domestic + international) ──────────────────────────────

for (const [label, countryCode, nationality] of [["domestic", "IN", "IN"], ["international", "AE", "AE"]] as const) {
  test(`instant ${label} booking: nothing is booked before payment; confirmed only on TripJack SUCCESS`, async () => {
    const store = newStore();
    const tj = tripjack(["IN_PROGRESS", "SUCCESS"]);
    const { d, queued } = deps(store, tj.client);
    const order = await newOrder(store, "INSTANT", review({ nationality, hotel: { ...review().hotel, countryCode } }));
    assert.equal(order.status, "PAYMENT_PENDING");
    assert.equal(tj.calls.book.length, 0);
    assert.equal(publicOrder(order).statusText, "Awaiting payment");

    const paid = await pay(d, order);
    assert.equal(paid.status, "PAYMENT_PENDING", "payment alone never confirms");
    assert.deepEqual(queued, [order.id]);

    const done = (await processPaidOrder(d, order.id))!;
    assert.equal(done.status, "CONFIRMED");
    assert.equal(done.confirmationNo, "HCN-778");
    const req = tj.calls.book[0];
    assert.deepEqual(req.paymentInfos, [{ amount: 30000 }]);
    assert.equal(req.roomTravellerInfo.length, 3);
    assert.deepEqual(req.roomTravellerInfo.map((r: any) => r.travellerInfo.map((t: any) => t.pt)),
      [["ADULT", "ADULT", "CHILD", "CHILD"], ["ADULT", "ADULT", "ADULT", "CHILD"], ["ADULT", "ADULT", "CHILD"]]);
    assert.deepEqual(req.deliveryInfo, { emails: ["a@b.co"], contacts: ["9876543210"], code: ["+91"] });

    // Queue retry / recovery: no second booking.
    await processPaidOrder(d, order.id);
    assert.equal(tj.calls.book.length, 1);
  });
}

test("paid booking that TripJack fails is refunded in full and never shown as confirmed", async () => {
  const store = newStore();
  const tj = tripjack(["FAILED"]);
  const { d, refunds } = deps(store, tj.client);
  const order = await newOrder(store, "INSTANT");
  await pay(d, order);
  const done = (await processPaidOrder(d, order.id))!;
  assert.equal(done.status, "FAILED");
  assert.equal(done.paymentStatus, "REFUNDED");
  assert.deepEqual(refunds.map((r) => r.amount), [30000]);
});

test("unknown book outcome (timeout) is never resubmitted; Booking Details decides later", async () => {
  const store = newStore();
  const timeout = Object.assign(new Error("timed out"), { code: "TIMEOUT" });
  const tj = tripjack(["IN_PROGRESS"], { bookError: timeout });
  const { d, refunds } = deps(store, tj.client);
  const order = await newOrder(store, "INSTANT");
  await pay(d, order);
  const first = (await processPaidOrder(d, order.id))!;
  assert.equal(first.status, "PROCESSING");
  assert.equal(refunds.length, 0, "no refund while the outcome is unknown");
  tj.setStatuses(["SUCCESS"]);
  const again = (await processPaidOrder(d, order.id))!;
  assert.equal(tj.calls.book.length, 1);
  assert.equal(again.status, "CONFIRMED");
});

test("definite TripJack rejection after payment refunds; one payment slot per order", async () => {
  const store = newStore();
  const rejected = Object.assign(new Error("OPTION_SOLD_OUT"), { code: "6506", statusCode: 400 });
  const tj = tripjack([""], { bookError: rejected });
  const { d, refunds } = deps(store, tj.client);
  const order = await newOrder(store, "INSTANT");
  const slot = (await claimPayment(store, order, "NOMOD", "link-1"))!;
  assert.equal(await claimPayment(store, order, "WALLET", "w-1"), null, "second payment attempt is refused");
  await recordPaid(d, slot, "charge-1");
  assert.equal(await recordPaid(d, slot, "charge-1"), null, "duplicate webhook does nothing");
  const done = (await processPaidOrder(d, order.id))!;
  assert.equal(done.status, "FAILED");
  assert.equal(refunds.length, 1);
  assert.equal(payable(done).ok, false);
});

// ── Hold → confirm ──────────────────────────────────────────────────────────

test("hold booking shows ON_HOLD with the supplier deadline, then confirms after payment", async () => {
  const store = newStore();
  const tj = tripjack(["ON_HOLD"], { deadline: "2026-11-25T18:00" });
  const { d } = deps(store, tj.client);
  const held = await placeHold(d, await newOrder(store, "HOLD"));
  assert.equal(tj.calls.book.length, 1);
  assert.equal(tj.calls.book[0].paymentInfos, undefined, "hold sends no paymentInfos");
  assert.equal(held.status, "ON_HOLD");
  assert.equal(held.holdDeadline, "2026-11-25T18:00");
  const view = publicOrder(held, d.now!());
  assert.equal(view.statusText, "On hold — not confirmed");
  assert.notEqual(view.status, "CONFIRMED");
  assert.equal(view.payment.payable, true);

  await pay(d, held);
  tj.setStatuses(["ON_HOLD", "SUCCESS"]);
  const done = (await processPaidOrder(d, held.id))!;
  assert.deepEqual(tj.calls.confirm, [{ bookingId: "TJH100200300", amount: 30000 }]);
  assert.equal(done.status, "CONFIRMED");
  await processPaidOrder(d, held.id);
  assert.equal(tj.calls.confirm.length, 1, "confirm-book sent once");
});

test("paid hold stays unconfirmed while TripJack still reports ON_HOLD", async () => {
  const store = newStore();
  const tj = tripjack(["ON_HOLD"]);
  const { d } = deps(store, tj.client);
  const held = await placeHold(d, await newOrder(store, "HOLD"));
  await pay(d, held);
  const after = (await processPaidOrder(d, held.id))!;
  assert.equal(after.status, "PROCESSING");
  assert.notEqual(publicOrder(after).status, "CONFIRMED");
});

test("expired hold auto-cancelled by the supplier shows CANCELLED and can't be paid", async () => {
  const store = newStore();
  const tj = tripjack(["ON_HOLD"], { deadline: "2026-10-31T18:00" });
  const { d, refunds } = deps(store, tj.client);
  const held = await placeHold(d, await newOrder(store, "HOLD"));
  assert.equal(payable(held, d.now!()).ok, false, "deadline passed");
  assert.equal(publicOrder(held, d.now!()).holdExpired, true);
  tj.setStatuses(["CANCELLED"]);
  const fresh = await refreshOrder(d, held, true);
  assert.equal(fresh.status, "CANCELLED");
  assert.equal(refunds.length, 0, "nothing was paid");
});

// ── Hold expiry (scheduled check) ───────────────────────────────────────────
// Deadline 2026-11-01T12:00 IST; the mocked clock starts at 10:00 and is moved past it.

async function heldOrder(store: HotelOrderStore, statuses = ["ON_HOLD"]) {
  const tj = tripjack(statuses, { deadline: "2026-11-01T12:00" });
  const ctx = deps(store, tj.client);
  const held = await placeHold(ctx.d, await newOrder(store, "HOLD"));
  assert.equal(held.status, "ON_HOLD");
  return { tj, ...ctx, held, advance: (ms: number) => { const t = ctx.d.now!() + ms; ctx.d.now = () => t; } };
}

test("hold expiry: nothing is checked before the deadline, and the deadline alone never cancels", async () => {
  const store = newStore();
  const h = await heldOrder(store);
  const before = h.tj.calls.details;
  assert.equal((await checkExpiredHold(h.d, h.held.id)).checked, false, "deadline not reached");
  assert.equal(h.tj.calls.details, before);

  h.advance(3 * 3600_000);   // 13:00 — an hour past the deadline; TripJack still reports ON_HOLD
  const r = await checkExpiredHold(h.d, h.held.id);
  assert.equal(r.checked, true);
  assert.equal(h.tj.calls.details, before + 1, "one Booking Details call");
  assert.equal(r.order!.status, "ON_HOLD", "not CANCELLED without TripJack saying so");
  assert.equal(r.order!.supplierStatus, "ON_HOLD");
});

test("hold expiry: TripJack confirms CANCELLED → order CANCELLED, nothing to refund, checks stop", async () => {
  const store = newStore();
  const h = await heldOrder(store);
  h.advance(3 * 3600_000);
  h.tj.setStatuses(["CANCELLED"]);
  const r = await checkExpiredHold(h.d, h.held.id);
  assert.equal(r.order!.status, "CANCELLED");
  assert.equal(r.order!.supplierStatus, "CANCELLED");
  assert.equal(r.order!.paymentStatus, "UNPAID");
  assert.equal(h.refunds.length, 0);
  assert.equal(publicOrder(r.order!, h.d.now!()).status, "CANCELLED", "customer page / My Trips / Admin read this status");
  h.advance(3600_000);
  assert.equal((await checkExpiredHold(h.d, h.held.id)).checked, false, "a cancelled hold is never re-checked");
});

test("hold expiry: duplicate deliveries / overlapping sweeps call TripJack once", async () => {
  const store = newStore();
  const h = await heldOrder(store);
  h.advance(3 * 3600_000);
  h.tj.setStatuses(["CANCELLED"]);
  const before = h.tj.calls.details;
  const results = await Promise.all([1, 2, 3, 4].map(() => checkExpiredHold(h.d, h.held.id)));
  assert.equal(results.filter((r) => r.checked).length, 1, "exactly one claim wins");
  assert.equal(h.tj.calls.details, before + 1);
  assert.equal((await store.get(h.held.id))!.status, "CANCELLED");
});

test("hold expiry: re-checked every 10 min while TripJack still holds it; a failed call changes nothing", async () => {
  const store = newStore();
  const h = await heldOrder(store);
  h.advance(3 * 3600_000);
  await checkExpiredHold(h.d, h.held.id);
  h.advance(5 * 60_000);
  assert.equal((await checkExpiredHold(h.d, h.held.id)).checked, false, "too soon");
  h.advance(6 * 60_000);
  const failing = { ...h.tj.client, async bookingDetails() { throw Object.assign(new Error("Invalid API key"), { statusCode: 403, code: "403" }); } };
  const r = await checkExpiredHold({ ...h.d, client: failing }, h.held.id);
  assert.equal(r.checked, true);
  assert.equal(r.order!.status, "ON_HOLD", "unreadable TripJack status never cancels");
  h.advance(11 * 60_000);
  h.tj.setStatuses(["CANCELLED"]);
  assert.equal((await checkExpiredHold(h.d, h.held.id)).order!.status, "CANCELLED");
});

test("hold expiry: paid holds are left to the confirm / refund flow", async () => {
  const store = newStore();
  const h = await heldOrder(store);
  await pay(h.d, h.held);
  h.advance(3 * 3600_000);
  const before = h.tj.calls.details;
  assert.equal(holdCheckDue((await store.get(h.held.id))!, h.d.now!()), false);
  assert.equal((await checkExpiredHold(h.d, h.held.id)).checked, false);
  assert.equal(h.tj.calls.details, before);
});

test("hold paid just before expiry: supplier released it, so the payment is refunded", async () => {
  const store = newStore();
  const tj = tripjack(["ON_HOLD"]);
  const { d, refunds } = deps(store, tj.client);
  const held = await placeHold(d, await newOrder(store, "HOLD"));
  await pay(d, held);
  tj.setStatuses(["CANCELLED"]);
  const done = (await processPaidOrder(d, held.id))!;
  assert.equal(tj.calls.confirm.length, 0);
  assert.equal(done.status, "CANCELLED");
  assert.equal(done.paymentStatus, "REFUNDED");
  assert.equal(refunds[0].amount, 30000);
});

test("hold cancellation releases the hold at no charge", async () => {
  const store = newStore();
  const tj = tripjack(["ON_HOLD"]);
  const { d, refunds } = deps(store, tj.client);
  const held = await placeHold(d, await newOrder(store, "HOLD"));
  const quote = cancelQuote(held, d.now!());
  assert.equal(quote.eligible, true);
  assert.equal(quote.charge, 0);
  tj.setStatuses(["CANCELLED"]);
  const done = await cancelOrder(d, held, 0);
  assert.deepEqual(tj.calls.cancel, ["TJH100200300"]);
  assert.equal(done.status, "CANCELLED");
  assert.equal(refunds.length, 0);
});

// ── Cancellation within / outside the deadline ──────────────────────────────

async function confirmedOrder(now: string) {
  const store = newStore();
  const tj = tripjack(["SUCCESS"]);
  const { d, refunds } = deps(store, tj.client, now);
  const order = await newOrder(store, "INSTANT");
  await pay(d, order);
  const confirmed = (await processPaidOrder(d, order.id))!;
  assert.equal(confirmed.status, "CONFIRMED");
  return { store, tj, d, refunds, confirmed };
}

test("cancellation inside the free window: no charge, full policy refund recorded after TripJack confirms", async () => {
  const { tj, d, confirmed, refunds } = await confirmedOrder("2026-11-10T10:00:00+05:30");
  const quote = cancelQuote(confirmed, d.now!());
  assert.equal(quote.charge, 0);
  assert.equal(quote.refund, 30000);
  tj.setStatuses(["CANCELLED"]);
  const done = await cancelOrder(d, confirmed, 0);
  assert.equal(done.status, "CANCELLED");
  assert.equal(done.paymentStatus, "REFUND_PENDING");
  assert.equal(Number(done.refundAmount), 30000);
  assert.equal(refunds.length, 0, "policy refunds are settled by the team, not auto-paid");
});

test("cancellation after the deadline applies the supplier penalty", async () => {
  const { tj, d, confirmed } = await confirmedOrder("2026-11-25T10:00:00+05:30");
  const quote = cancelQuote(confirmed, d.now!());
  assert.equal(quote.charge, 12000);
  assert.equal(quote.refund, 18000);
  await assert.rejects(cancelOrder(d, confirmed, 0), /charge has changed/);
  tj.setStatuses(["CANCELLED"]);
  const done = await cancelOrder(d, (await d.store.get(confirmed.id))!, 12000);
  assert.equal(Number(done.refundAmount), 18000);
});

test("cancel accepted but TripJack still SUCCESS → CANCELLATION_PENDING, not CANCELLED", async () => {
  const { d, confirmed } = await confirmedOrder("2026-11-10T10:00:00+05:30");
  const done = await cancelOrder(d, confirmed, 0);
  assert.equal(done.status, "CANCELLATION_PENDING");
  assert.equal(done.paymentStatus, "PAID");
});

test("rejected cancellation leaves the booking as it was", async () => {
  const store = newStore();
  const tj = tripjack(["SUCCESS"], { cancelError: Object.assign(new Error("not allowed"), { code: "CANCEL_NOT_ALLOWED", statusCode: 400 }) });
  const { d } = deps(store, tj.client, "2026-11-10T10:00:00+05:30");
  const order = await newOrder(store, "INSTANT");
  await pay(d, order);
  const confirmed = (await processPaidOrder(d, order.id))!;
  await assert.rejects(cancelOrder(d, confirmed, 0), /did not accept/);
  const after = (await store.get(order.id))!;
  assert.equal(after.status, "CONFIRMED");
  assert.equal(after.cancellation, null);
});

test("unpaid or failed bookings are not cancellable", async () => {
  const store = newStore();
  const order = await newOrder(store, "INSTANT");
  assert.equal(cancelQuote(order).eligible, false);
});

test("non-refundable policy charges the full amount", () => {
  const q = cancellationChargeAt({ isRefundable: false, penalties: [] }, 5000);
  assert.deepEqual([q.charge, q.refund, q.basis], [5000, 0, "NON_REFUNDABLE"]);
});

// ── Access + order creation route ───────────────────────────────────────────

test("order access needs the key or the customer who made it", async () => {
  const store = newStore();
  const order = await newOrder(store, "INSTANT");
  assert.equal(await canAccess(order, { key: "secret-key" }), true);
  assert.equal(await canAccess(order, { key: "wrong" }), false);
  assert.equal(await canAccess(order, { userId: "user-1" }), true);
  assert.equal(await canAccess(order, { userId: "someone-else" }), false);
});

function orderApp(kv: Record<string, unknown>) {
  const app = new Hono<any>();
  app.use("*", async (c, n) => { c.set("tenantId", "t1"); c.set("db", { insert: () => ({ values: async () => {} }) }); await n(); });
  app.route("/h", hotelRoutes);
  const env = { SESSIONS_KV: { get: async (k: string) => kv[k] ?? null, put: async () => {} }, JWT_SECRET: "x" };
  return (body: unknown) => app.fetch(new Request("http://x/h/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    env, { waitUntil: (p: any) => p, passThroughOnException() {} } as any);
}

const orderBody = (over: Record<string, unknown> = {}) => ({
  bookingId: "TJH100200300", mode: "INSTANT", contactEmail: "a@b.co", contactPhone: "9876543210", dialCode: "+91",
  rooms: UAT_GUESTS.map((guests) => ({ guests })), ...over,
});

test("order route: expired review, hold not allowed and guest mismatch are rejected before TripJack", async () => {
  let res = await orderApp({})(orderBody());
  assert.equal(res.status, 410);
  const kv = { "hotel_review:t1:TJH100200300": review({ onholdAllowed: false }) };
  res = await orderApp(kv)(orderBody({ mode: "HOLD" }));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).errorCode, "HOLD_NOT_ALLOWED");
  res = await orderApp(kv)(orderBody({ rooms: UAT_GUESTS.slice(0, 2).map((guests) => ({ guests })) }));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).errorCode, "INVALID_GUESTS");
});

test("a paid order waiting for TripJack shows 'Confirming with the hotel', never 'Awaiting payment' (TJP209903275079)", async () => {
  const store = newStore();
  const tj = tripjack(["PAYMENT_SUCCESS", "SUCCESS"]);
  const { d } = deps(store, tj.client);
  const order = await newOrder(store, "INSTANT");
  assert.equal(publicOrder(order).statusText, "Awaiting payment");
  const paid = await pay(d, order);                       // debited, queue not yet run
  const view = publicOrder(paid);
  assert.equal(view.status, "PROCESSING");
  assert.equal(view.statusText, "Confirming with the hotel");
  assert.equal(view.pending, true, "booking page keeps polling");
  assert.equal(view.payment.status, "PAID");
  assert.equal(view.payment.payable, false);
  assert.equal(view.canCancel, false);
  const done = (await processPaidOrder(d, order.id))!;
  assert.equal(publicOrder(done).status, "CONFIRMED");
  assert.equal(publicOrder(done).pending, false);
  assert.equal(tj.calls.book.length, 1);
});

test("a paid hold awaiting confirm-book shows as confirming and can't be cancelled mid-confirm", async () => {
  const store = newStore();
  const tj = tripjack(["ON_HOLD"]);
  const { d } = deps(store, tj.client);
  const held = await placeHold(d, await newOrder(store, "HOLD"));
  const paid = await pay(d, held);
  assert.equal(publicOrder(paid, d.now!()).status, "PROCESSING");
  assert.equal(cancelQuote(paid, d.now!()).eligible, false);
  await assert.rejects(cancelOrder(d, paid, 0), /can't be cancelled/);
  assert.equal(tj.calls.cancel.length, 0);
});

// ── UPI (PhonePe PG v2) ─────────────────────────────────────────────────────

test("UPI: paid only when PhonePe's status API reports the exact amount; queued once", async () => {
  const { reconcilePhonePePayment } = await import("../src/lib/hotel-orders.js");
  const store = newStore();
  const { d, queued } = deps(store, {});
  const ledger: string[] = [];
  let state = { state: "PENDING", amountPaise: 3000000, transactionId: "TX9" as string | null };
  d.phonepeStatus = async () => state;
  d.ledger = async (_o, event) => { ledger.push(event); };
  const order = await newOrder(store, "INSTANT");
  const slot = (await claimPayment(store, order, "PHONEPE", "TCHU_ABC_1"))!;
  assert.equal((await reconcilePhonePePayment(d, slot)).paymentStatus, "PENDING");

  state = { state: "COMPLETED", amountPaise: 100, transactionId: "TX9" };   // ₹1 reported for a ₹30,000 order
  let o = await reconcilePhonePePayment(d, slot);
  assert.equal(o.paymentStatus, "PENDING");
  assert.deepEqual(queued, []);
  assert.ok(ledger.includes("AMOUNT_MISMATCH"));

  state = { state: "COMPLETED", amountPaise: 3000000, transactionId: "TX9" };
  o = await refreshOrder(d, (await store.get(slot.id))!);
  assert.equal(o.paymentStatus, "PAID");
  assert.equal(o.paymentRef, "TX9");
  await refreshOrder(d, o);                  // webhook + page reload: no second booking
  assert.deepEqual(queued, [slot.id]);
  assert.ok(ledger.includes("CAPTURED"));
});

test("UPI: a failed PhonePe order frees the payment slot for a retry", async () => {
  const { reconcilePhonePePayment } = await import("../src/lib/hotel-orders.js");
  const store = newStore();
  const { d } = deps(store, {});
  d.phonepeStatus = async () => ({ state: "FAILED", amountPaise: 0, transactionId: null });
  const order = await newOrder(store, "INSTANT");
  const slot = (await claimPayment(store, order, "PHONEPE", "TCHU_ABC_2"))!;
  const o = await reconcilePhonePePayment(d, slot);
  assert.equal(o.paymentStatus, "UNPAID");
  assert.ok(await claimPayment(store, o, "NOMOD", null), "customer can pay again");
});

test("UPI refunds only use the credentials of the order's PhonePe environment", async () => {
  const { refundHotelPayment } = await import("../src/lib/hotel-order-store.js");
  const db: any = { insert: () => ({ values: async () => {} }) };
  const order = { ...(await newOrder(newStore(), "INSTANT")), paymentGateway: "PHONEPE", paymentOrderId: "TCHP_LIVE_1", paymentStatus: "PAID" } as HotelOrder;
  // Worker on UAT, order taken in Production → never refunded with UAT credentials.
  const env: any = { PHONEPE_UAT_CLIENT_ID: "u", PHONEPE_UAT_CLIENT_SECRET: "s", PHONEPE_UAT_CLIENT_VERSION: "1", SESSIONS_KV: { get: async () => null, put: async () => {} } };
  const r = await refundHotelPayment(env, db, order, 30000, "test");
  assert.equal(r.ok, false);
  assert.match(r.note, /needs the team/);
});
