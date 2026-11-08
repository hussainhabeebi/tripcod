// TripJack Hotel API v3.
//
//   POST /api/hotels/search             city (or hotel IDs) → hotels with cheapest option
//   POST /api/hotels/detail             all options for one hotel (+ static details)
//   POST /api/hotels/review             re-validate an option → TripJack bookingId + final price
//   POST /api/hotels/orders             guests + Instant (pay first) or Hold → Tripcod order
//   GET  /api/hotels/orders/mine        signed-in customer's hotel bookings (My Trips)
//   GET  /api/hotels/orders/:id         order (re-reads TripJack Booking Details while it can change)
//   GET  /api/hotels/orders/:id/payment-options   card (Nomod) / wallet availability
//   POST /api/hotels/orders/:id/pay     card link or wallet debit → TripJack book / confirm-book after capture
//   GET  /api/hotels/orders/:id/cancel-quote      charge + refund from the supplier's policy
//   POST /api/hotels/orders/:id/cancel  TripJack cancel-booking after the customer confirms the charge
//   GET  /api/hotels/bookings/:id       booking details (status polling)
//   Order routes need the order's access key (X-Hotel-Order-Key) or the signed-in
//   customer who made it. Admin keeps its own confirm / cancel / list routes
//   (/api/admin/hotels) and the city sync.
//   GET  /api/hotels/nationalities      nationality list (ISO2 + TripJack countryId)
//
// Every TripJack call is written to Admin → Supplier logs with the full error.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  HOTEL_OCCUPANCY_LIMITS, HOTEL_TERMINAL_STATUSES, validHotelId, isHotelError, normalizeOption, parseHotelBookingDetails,
  guestErrors, occupancyErrors, type RoomOccupancy, type TripjackHotelV3Client,
} from "@tripcod/suppliers";
import { optionalCustomerId } from "../lib/optional-customer.js";
import { WEB_URL } from "../lib/customer-notify.js";
import {
  CUSTOMER_WALLET_CURRENCY, debitWallet, getOrCreateCustomerWallet, roundMoney,
} from "../lib/customer-wallet.js";
import {
  HotelOrderError, REVIEW_TTL_SECONDS, buildOrderRow, canAccess, cancelOrder, cancelQuote, claimPayment, newAccessKey,
  payable, placeHold, publicOrder, recordPaid, refreshOrder, releasePayment, reviewKey, sha256Hex,
  type HotelOrder, type HotelOrderDeps, type ReviewSnapshot,
} from "../lib/hotel-orders.js";
import { cardPaymentAvailable, createHotelNomodLink, createHotelPhonePeOrder, hotelOrderDeps, upiPaymentAvailable } from "../lib/hotel-order-store.js";
import { resolvePhonePeConfig } from "../lib/phonepe.js";
import type { Env, Variables } from "../types.js";
import { logSupplierCall } from "../lib/supplier-logger.js";
import {
  SEARCH_TTL_MS, hotelExchanges, hotelRecorder, cheapest, hotelClient, hotelContent, nationalityId, nightsBetween, searchHotels,
} from "../lib/hotels.js";

// ── Logging helpers ─────────────────────────────────────────────────────────

function errorCodeOf(err: any): string {
  if (err?.code) return String(err.code);
  if (typeof err?.statusCode === "number") return `HTTP_${err.statusCode}`;
  if (err?.name === "TimeoutError" || /timed out|timeout/i.test(String(err?.message))) return "TIMEOUT";
  return err?.name === "TypeError" ? "NETWORK_ERROR" : "HOTEL_API_ERROR";
}

function errorMessageOf(err: any): string {
  const base = err instanceof Error ? err.message : String(err);
  const hint = err?.code === "UNSUPPORTED_TRIPJACK_ROUTE" || err?.statusCode === 404
    ? " — route not found: redeploy the TripJack gateway (hotel v3 routes) and check TRIPJACK_HMS_UPSTREAM / TRIPJACK_HOTEL_BOOKER_UPSTREAM"
    : err?.statusCode === 401 || err?.statusCode === 403 || ["UNAUTHORIZED", "FORBIDDEN", "API_KEY_SUSPENDED", "6518", "6519", "6520"].includes(String(err?.code))
      ? " — the hotel API key is not valid for this TripJack hotel environment (UAT and Production keys are separate; check Admin → Integrations → TripJack → Hotels), or the gateway IP is not whitelisted on the TripJack hotel hosts"
      : "";
  return `${base}${hint}`;
}

export async function logged<T>(
  c: any, endpoint: string, requestSummary: Record<string, unknown>,
  call: () => Promise<T>, summarize: (result: T) => Record<string, unknown> = () => ({}),
): Promise<T> {
  const started = Date.now();
  // Same ID as the raw request / response files recorded for this call.
  const requestId = c.get("hotelRequestId") ?? crypto.randomUUID();
  const base = { tenantId: c.get("tenantId"), supplier: "TRIPJACK" as const, endpoint, requestId };
  try {
    const result = await call();
    c.executionCtx.waitUntil(logSupplierCall(c.get("db"), {
      ...base, level: "INFO", httpStatus: 200, durationMs: Date.now() - started,
      requestSummary: { ...requestSummary, ...summarize(result) },
    }));
    return result;
  } catch (err: any) {
    console.error(`[hotel] ${endpoint} failed`, err);
    await logSupplierCall(c.get("db"), {
      ...base, level: "ERROR",
      httpStatus: typeof err?.statusCode === "number" ? err.statusCode : undefined,
      errorCode: errorCodeOf(err),
      errorMessage: errorMessageOf(err),
      responseSnippet: typeof err?.responseSnippet === "string" ? err.responseSnippet : String(err?.stack ?? err).slice(0, 800),
      requestSummary: { ...requestSummary, tripjackEndpoint: err?.endpoint,
        ...(err?.syncPhase ? { syncPage: err.syncPage, pagesDone: err.pagesDone, syncPhase: err.syncPhase } : {}),
        ...(err?.gatewayRequestId ? { gatewayRequestId: err.gatewayRequestId } : {}),
        ...(err?.upstreamStatus != null ? { upstreamStatus: err.upstreamStatus } : {}),
      },
      durationMs: Date.now() - started,
    });
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { requestId });
  }
}

// TripJack hotel error codes that the customer can fix on the checkout form.
const GUEST_DETAIL_ERRORS: Record<string, { errorCode: string; message: string }> = {
  "1092": { errorCode: "PAN_REQUIRED", message: "This hotel needs a valid PAN (Indian tax ID, e.g. ABCDE1234F) for the lead guest. Please add it and confirm again." },
};

export function hotelError(c: any, err: any, fallback: string) {
  const code = errorCodeOf(err);
  const fixable = GUEST_DETAIL_ERRORS[code];
  if (fixable) return c.json({ error: fixable.message, errorCode: fixable.errorCode, supplierCode: code, requestId: err?.requestId }, 400);
  const status = isHotelError(err, "SESSION_EXPIRED") ? 410 : isHotelError(err, "SOLD_OUT") ? 409
    : ["CITY_INDEX_MISSING", "CITY_NOT_SYNCED", "CITY_NOT_FOUND", "NATIONALITY_UNSUPPORTED"].includes(code) ? 404 : 502;
  const message = isHotelError(err, "SESSION_EXPIRED") ? "Your search has expired. Please search again."
    : isHotelError(err, "SOLD_OUT") ? "This room was just sold out. Please choose another option."
    : isHotelError(err, "PRICE_CHANGED") ? "The price for this room has changed. Please review the new price."
    : err?.message ?? fallback;
  return c.json({ error: message, errorCode: code, requestId: err?.requestId }, status);
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const LIM = HOTEL_OCCUPANCY_LIMITS;
// TripJack needs one age per child: childAge.length must equal children.
const roomSchema = z.object({
  adults:    z.number().int().min(LIM.minAdultsPerRoom).max(LIM.maxAdultsPerRoom).default(1),
  children:  z.number().int().min(0).max(LIM.maxChildrenPerRoom).default(0),
  childAge:  z.array(z.number().int().min(LIM.minChildAge).max(LIM.maxChildAge)).max(LIM.maxChildrenPerRoom).optional(),
  childAges: z.array(z.number().int().min(LIM.minChildAge).max(LIM.maxChildAge)).max(LIM.maxChildrenPerRoom).optional(),   // older clients
}).refine((r) => (r.childAge ?? r.childAges ?? []).length === r.children, {
  message: "Each child needs an age (childAge must have one age per child)", path: ["childAge"],
}).transform((r) => ({
  adults: r.adults,
  ...(r.children ? { children: r.children, childAge: r.childAge ?? r.childAges ?? [] } : {}),
}));

const occupancyOf = (rooms: { adults: number; childAge?: number[] }[]): RoomOccupancy[] =>
  rooms.map((r) => ({ adults: r.adults, childAges: r.childAge ?? [] }));

const stayFields = {
  checkIn:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rooms:       z.array(roomSchema).min(1).max(LIM.maxRooms).default([{ adults: 1, children: 0 }]),
  nationality: z.string().min(2).max(6).default("IN"),
  currency:    z.string().length(3).toUpperCase().default("INR"),
};

const searchSchema = z.object({
  cityCode:    z.string().optional(),
  cityName:    z.string().optional(),
  countryCode: z.string().length(2).optional(),
  hids:        z.array(z.string().regex(/^\d+$/)).max(300).optional(),
  ...stayFields,
}).refine((b) => b.cityCode || b.cityName || b.hids?.length, { message: "cityCode, cityName or hids is required" });

// TripJack hotel IDs are numeric today; accept any plain ID so a format change
// doesn't block checkout (it is only ever sent back to TripJack).
const detailSchema = z.object({ correlationId: z.string().min(8), hid: z.string().refine(validHotelId, "Invalid TripJack hotel ID"), ...stayFields });

const reviewSchema = detailSchema.extend({
  optionId:   z.string().min(1),
  reviewHash: z.string().optional(),
});

const guestSchema = z.object({
  title:     z.string().min(1).max(10),
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  type:      z.enum(["ADULT", "CHILD"]).default("ADULT"),
  pan:       z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/i).optional(),
  passport:  z.string().min(5).optional(),
});

// The price, hotel and occupancy come from the server-side Review snapshot, not the browser.
const orderSchema = z.object({
  bookingId:    z.string().min(5).max(64).regex(/^[A-Za-z0-9_-]+$/),
  mode:         z.enum(["INSTANT", "HOLD"]),
  rooms:        z.array(z.object({ guests: z.array(guestSchema).min(1).max(LIM.maxAdultsPerRoom + LIM.maxChildrenPerRoom) })).min(1).max(LIM.maxRooms),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(6).max(20),
  dialCode:     z.string().regex(/^\+?\d{1,4}$/).default("+91"),
});

export const hotelRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
hotelRoutes.use("*", hotelExchanges);

// Request validation with a readable reason ("checkIn: Invalid") instead of the
// raw zod object, logged to Admin → Supplier logs so a rejected request shows up.
function validJson<T extends z.ZodTypeAny>(schema: T, endpoint: string) {
  return zValidator("json", schema, (result, c: any) => {
    if (result.success) return;
    const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    c.executionCtx.waitUntil(logSupplierCall(c.get("db"), {
      tenantId: c.get("tenantId"), supplier: "TRIPJACK", endpoint: `hotel ${endpoint}`, level: "WARN",
      errorCode: "INVALID_REQUEST", errorMessage: `Hotel ${endpoint} request rejected before calling TripJack — ${issues.join("; ")}`,
      requestSummary: { issues, body: (result as any).data },
    }).catch(() => {}));
    return c.json({ error: `Some booking details are invalid (${issues[0]}). Please search again.`, code: "INVALID_REQUEST", issues }, 400);
  });
}

// ── Search ──────────────────────────────────────────────────────────────────

hotelRoutes.post("/search", validJson(searchSchema, "search"), async (c) => {
  const params = c.req.valid("json");
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    const result = await logged(c, "/hms/v3/hotel/listing", {
      city: params.cityName ?? params.cityCode, hids: params.hids?.length, checkIn: params.checkIn, checkOut: params.checkOut,
      rooms: params.rooms.length, guests: params.rooms.reduce((n, r) => n + r.adults + (r.children ?? 0), 0),
      nationality: params.nationality, currency: params.currency,
    }, () => searchHotels(c.env, client, params), (r) => ({
      correlationId: r.correlationId, candidates: r.totalCandidates, hotelCount: r.hotels.length,
    }));
    return c.json({
      searchId:      result.correlationId,
      correlationId: result.correlationId,
      expiresAt:     new Date(Date.now() + SEARCH_TTL_MS).toISOString(),
      city:          result.city,
      hotels:        result.hotels,
      totalCandidates: result.totalCandidates,
      supplier:      "TRIPJACK",
    });
  } catch (err) {
    return hotelError(c, err, "Hotel search failed");
  }
});

// ── Detail (all options for one hotel) ──────────────────────────────────────

async function pricingFor(c: any, client: TripjackHotelV3Client, p: z.infer<typeof detailSchema>) {
  const nationality = await nationalityId(c.env, client, p.nationality);
  return logged(c, "/hms/v3/hotel/pricing", { correlationId: p.correlationId, hid: p.hid, checkIn: p.checkIn, checkOut: p.checkOut },
    () => client.pricing({ correlationId: p.correlationId, hid: p.hid, checkIn: p.checkIn, checkOut: p.checkOut,
      rooms: p.rooms, currency: p.currency, nationality, timeoutMs: 13000 }),
    (r) => ({ optionCount: r.options?.length ?? 0 }));
}

hotelRoutes.post("/detail", validJson(detailSchema, "detail"), async (c) => {
  const p = c.req.valid("json");
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    const [pricing, content] = await Promise.all([pricingFor(c, client, p), hotelContent(c.env, client, [p.hid])]);
    const options = (pricing.options ?? []).map(normalizeOption).sort((a, b) => a.pricing.totalPrice - b.pricing.totalPrice);
    return c.json({
      correlationId: p.correlationId,
      hid:           p.hid,
      hotelName:     pricing.hotelName ?? content[p.hid]?.name ?? "",
      hotel:         content[p.hid] ?? null,
      reviewHash:    pricing.reviewHash,
      options,
    });
  } catch (err) {
    return hotelError(c, err, "Could not load this hotel's rooms");
  }
});

// ── Review (re-validate the chosen option; returns TripJack bookingId) ───────

hotelRoutes.post("/review", validJson(reviewSchema, "review"), async (c) => {
  const p = c.req.valid("json");
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    let reviewHash = p.reviewHash;
    let optionId = p.optionId;
    let listedPrice: number | undefined;
    if (!reviewHash) {
      // Coming straight from search: fetch the hotel's options for the reviewHash.
      const pricing = await pricingFor(c, client, p);
      reviewHash = pricing.reviewHash;
      const options = (pricing.options ?? []).map(normalizeOption);
      const same = options.find((o) => o.optionId === optionId);
      const pick = same ?? cheapest(options);
      if (!pick) return c.json({ error: "No rooms are available at this hotel for these dates.", errorCode: "NO_OPTIONS" }, 409);
      optionId = pick.optionId;
      listedPrice = pick.pricing.totalPrice;
    }
    const review = await logged(c, "/hms/v3/hotel/review", { correlationId: p.correlationId, hid: p.hid, optionId },
      () => client.review({ correlationId: p.correlationId, optionId, reviewHash: reviewHash!, hid: p.hid }),
      (r) => ({ bookingId: r.bookingId, totalPrice: r.option?.pricing?.totalPrice }));
    const option = normalizeOption(review.option);
    const onholdAllowed = String(review.onholdAllowed) === "true";
    const info = (await hotelContent(c.env, client, [p.hid]).catch(() => ({} as Awaited<ReturnType<typeof hotelContent>>)))[p.hid];
    const hotel: ReviewSnapshot["hotel"] = {
      hid: p.hid, name: review.hotelName || info?.name || "", address: info?.address ?? "", city: info?.city ?? "",
      countryCode: (info?.countryCode ?? "").toUpperCase(), stars: info?.starRating ?? 0, image: info?.images?.[0],
      checkIn: p.checkIn, checkOut: p.checkOut, nights: nightsBetween(p.checkIn, p.checkOut),
    };
    const occupancy = occupancyOf(p.rooms);
    // The order is priced from this snapshot (TripJack's reviewed total), never from the browser.
    const snapshot: ReviewSnapshot = {
      tenantId: c.get("tenantId"), bookingId: review.bookingId, hid: p.hid, correlationId: p.correlationId, hotel, occupancy,
      nationality: /^[A-Za-z]{2}$/.test(p.nationality) ? p.nationality.toUpperCase() : "IN", currency: p.currency,
      option, onholdAllowed, reviewedAt: new Date().toISOString(),
    };
    await c.env.SESSIONS_KV.put(reviewKey(snapshot.tenantId, review.bookingId), JSON.stringify(snapshot), { expirationTtl: REVIEW_TTL_SECONDS });
    return c.json({
      bookingId:     review.bookingId,
      hid:           p.hid,
      hotelName:     review.hotelName,
      hotel,
      occupancy,
      option,
      optionChanged: optionId !== p.optionId,
      priceChanged:  listedPrice !== undefined && Math.abs(listedPrice - option.pricing.totalPrice) > 0.01,
      onholdAllowed,
      reviewExpiresAt: new Date(Date.now() + REVIEW_TTL_SECONDS * 1000).toISOString(),
    });
  } catch (err) {
    return hotelError(c, err, "Could not confirm this room");
  }
});

// ── Book ────────────────────────────────────────────────────────────────────

export async function pollDetails(c: any, client: TripjackHotelV3Client, bookingId: string, maxMs: number) {
  const started = Date.now();
  let last: ReturnType<typeof parseHotelBookingDetails> | null = null;
  while (Date.now() - started < maxMs) {
    try {
      last = parseHotelBookingDetails(await client.bookingDetails(bookingId));
      if (HOTEL_TERMINAL_STATUSES.includes(last.status)) return last;
    } catch (err) {
      console.warn(`[hotel] booking-details ${bookingId} failed`, err);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return last;
}

// ── Orders (guests, Instant / Hold, payment, cancellation) ──────────────────

// Mounted under /orders: order IDs, keys and supplier IDs are linked in the raw API logs.
async function orderDeps(c: any, pollMs?: number): Promise<HotelOrderDeps> {
  const deps = await hotelOrderDeps(c.env, c.get("db"), c.get("tenantId"), {
    recorder: hotelRecorder(c), waitUntil: (p) => c.executionCtx.waitUntil(p), pollMs,
  });
  // Supplier calls inside a request also go through `logged` (same request ID as the raw exchange files).
  return { ...deps, call: (endpoint, summary, fn) => logged(c, endpoint, summary, fn) };
}

function orderError(c: any, err: any, fallback: string) {
  if (err instanceof HotelOrderError) return c.json({ error: err.message, errorCode: err.code, ...err.extra }, err.status);
  return hotelError(c, err, fallback);
}

// The order, if the caller may see it: the signed-in customer who made it, or the order's key.
async function accessibleOrder(c: any, deps: Pick<HotelOrderDeps, "store">): Promise<HotelOrder> {
  const order = await deps.store.get(c.req.param("id"));
  const userId = await optionalCustomerId(c);
  if (!order || !(await canAccess(order, { userId, key: c.req.header("X-Hotel-Order-Key") ?? null }))) {
    throw new HotelOrderError("Hotel booking not found", 404, "NOT_FOUND");
  }
  return order;
}

hotelRoutes.post("/orders", validJson(orderSchema, "order"), async (c) => {
  const p = c.req.valid("json");
  const tenantId = c.get("tenantId");
  try {
    const review = await c.env.SESSIONS_KV.get(reviewKey(tenantId, p.bookingId), "json") as ReviewSnapshot | null;
    if (!review) throw new HotelOrderError("Your room price check has expired. Please choose the room again to get a fresh price.", 410, "REVIEW_EXPIRED");
    if (p.mode === "HOLD" && !review.onholdAllowed) throw new HotelOrderError("This room can't be held — the supplier only allows instant booking for it.", 400, "HOLD_NOT_ALLOWED");
    const guests = p.rooms.map((r) => r.guests);
    const problems = [...occupancyErrors(review.occupancy), ...guestErrors(review.occupancy, guests, {
      nationality: review.nationality, hotelCountryCode: review.hotel.countryCode,
      panRequired: review.option.compliance.panRequired, passportRequired: review.option.compliance.passportRequired,
    })];
    if (problems.length) throw new HotelOrderError(problems[0], 400, "INVALID_GUESTS", { issues: problems });

    const accessKey = newAccessKey();
    const deps = await orderDeps(c);
    const row = buildOrderRow({
      review, mode: p.mode, userId: await optionalCustomerId(c), guests,
      contactEmail: p.contactEmail, contactPhone: p.contactPhone, dialCode: p.dialCode, accessKeyHash: await sha256Hex(accessKey),
    });
    const created = await deps.store.insert(row);
    if (!created) {
      // Double submit: the first order owns this TripJack booking.
      const existing = await deps.store.bySupplierBooking(tenantId, p.bookingId);
      throw new HotelOrderError("This room is already being booked. Open the booking you started, or choose the room again.", 409, "ORDER_EXISTS",
        { orderId: existing?.id });
    }
    let order = created;
    if (p.mode === "HOLD") {
      try { order = await placeHold(deps, created); }
      catch (err: any) { return c.json({ error: hotelErrorMessage(err, "The supplier could not hold this room."), errorCode: "HOLD_FAILED", order: publicOrder(err?.order ?? created), key: accessKey }, 502); }
    }
    return c.json({ order: publicOrder(order), key: accessKey }, 201);
  } catch (err) {
    return orderError(c, err, "Could not start the hotel booking");
  }
});

function hotelErrorMessage(err: any, fallback: string) {
  if (isHotelError(err, "SOLD_OUT")) return "This room was just sold out. Please choose another option.";
  if (isHotelError(err, "SESSION_EXPIRED")) return "Your search has expired. Please search again.";
  return err?.message ? `${fallback} (${String(err.message).slice(0, 200)})` : fallback;
}

hotelRoutes.get("/orders/mine", async (c) => {
  const userId = await optionalCustomerId(c);
  if (!userId) return c.json({ error: "Sign in to see your hotel bookings", errorCode: "SIGN_IN" }, 401);
  const deps = await orderDeps(c);
  const rows = await deps.store.listByUser(c.get("tenantId"), userId);
  return c.json({ orders: rows.map((o) => publicOrder(o)) });
});

hotelRoutes.get("/orders/:id", async (c) => {
  try {
    const deps = await orderDeps(c, 0);
    const order = await accessibleOrder(c, deps);
    const fresh = await refreshOrder(deps, order, c.req.query("refresh") === "1");
    return c.json({ order: publicOrder(fresh) });
  } catch (err) {
    return orderError(c, err, "Could not load the hotel booking");
  }
});

hotelRoutes.get("/orders/:id/payment-options", async (c) => {
  try {
    const deps = await orderDeps(c, 0);
    const order = await accessibleOrder(c, deps);
    const userId = await optionalCustomerId(c);
    let wallet: { available: boolean; balance: number | null; reason: string | null } = { available: false, balance: null, reason: "Sign in to pay from your Tripcod wallet." };
    if (userId && userId === order.userId) {
      const w = await getOrCreateCustomerWallet(c.get("db"), c.get("tenantId"), userId);
      const balance = Number(w.balance);
      const covers = order.currency === CUSTOMER_WALLET_CURRENCY && balance >= roundMoney(Number(order.amount));
      wallet = { available: covers, balance, reason: covers ? null : order.currency !== CUSTOMER_WALLET_CURRENCY
        ? `The wallet pays ${CUSTOMER_WALLET_CURRENCY} bookings only.` : "Your wallet balance doesn't cover this booking." };
    } else if (userId) {
      wallet.reason = "This booking was started without signing in, so the wallet can't be used for it.";
    }
    const pay = payable(order);
    return c.json({
      payable: pay.ok, reason: pay.ok ? null : pay.reason,
      card: { available: await cardPaymentAvailable(c.env, c.get("tenantId")), gateway: "NOMOD" },
      wallet,
      // UPI / cards / netbanking via PhonePe PG v2 (INR only; off until Admin enables it and its secrets are set).
      upi: await (async () => {
        const on = await upiPaymentAvailable(c.env, c.get("tenantId"));
        return { available: on && order.currency === "INR", gateway: "PHONEPE", testMode: on && resolvePhonePeConfig(c.env)?.environment === "UAT",
          reason: !on ? "UPI isn't available right now." : order.currency !== "INR" ? "UPI is available for INR bookings only." : null };
      })(),
      amount: Number(order.amount), currency: order.currency,
    });
  } catch (err) {
    return orderError(c, err, "Could not load payment options");
  }
});

hotelRoutes.post("/orders/:id/pay", zValidator("json", z.object({ method: z.enum(["CARD", "WALLET", "UPI"]) })), async (c) => {
  const { method } = c.req.valid("json");
  const tenantId = c.get("tenantId");
  try {
    const deps = await orderDeps(c, 0);
    let order = await accessibleOrder(c, deps);
    // Settles a wallet payment interrupted between the D1 claim and the Neon debit,
    // and for a hold re-reads TripJack (the hold must still exist).
    order = await refreshOrder(deps, order, order.mode === "HOLD");
    if (order.paymentStatus === "PENDING") {
      // An open card link for this order is reused rather than opening a second charge.
      if (method === "CARD" && order.paymentGateway === "NOMOD" && order.paymentUrl && payable(order).ok) return c.json({ paymentUrl: order.paymentUrl, reused: true });
      if (method === "UPI" && order.paymentGateway === "PHONEPE" && order.paymentUrl && payable(order).ok) return c.json({ paymentUrl: order.paymentUrl, reused: true });
      throw new HotelOrderError("A payment for this booking is already in progress. Complete it or wait a minute and reload.", 409, "PAYMENT_IN_PROGRESS");
    }
    const pay = payable(order);
    if (!pay.ok) throw new HotelOrderError(pay.reason, 409, pay.code);

    if (method === "WALLET") {
      const userId = await optionalCustomerId(c);
      if (!userId || userId !== order.userId) throw new HotelOrderError("Sign in with the account that made this booking to pay from the wallet.", 403, "WALLET_SIGN_IN");
      if (order.currency !== CUSTOMER_WALLET_CURRENCY) throw new HotelOrderError(`The wallet pays ${CUSTOMER_WALLET_CURRENCY} bookings only.`, 400, "WALLET_CURRENCY");
      const ref = `hotel_wallet_${order.id}_${Date.now()}`;
      const slot = await claimPayment(deps.store, order, "WALLET", ref);
      if (!slot) throw new HotelOrderError("A payment for this booking is already in progress.", 409, "PAYMENT_IN_PROGRESS");
      const wallet = await getOrCreateCustomerWallet(c.get("db"), tenantId, userId);
      const balance = await debitWallet(c.get("db"), wallet.id, Number(order.amount), "BOOKING_DEBIT", {
        bookingId: order.id, paymentId: ref, note: `Hotel booking ${order.supplierBookingId}`, performedById: userId,
      });
      if (balance === null) {
        await releasePayment(deps.store, slot);
        throw new HotelOrderError("Your wallet balance doesn't cover this booking. You have not been charged.", 402, "WALLET_INSUFFICIENT");
      }
      const paid = await recordPaid(deps, slot, ref);
      return c.json({ paid: true, order: publicOrder(paid ?? slot), balance });
    }

    if (method === "UPI") {
      // PhonePe hosted checkout; confirmed by the status API (webhook or this page's reload).
      const slot = await claimPayment(deps.store, order, "PHONEPE", null);
      if (!slot) throw new HotelOrderError("A payment for this booking is already in progress.", 409, "PAYMENT_IN_PROGRESS");
      let pp: { id: string; url: string };
      try {
        pp = await createHotelPhonePeOrder(c.env, tenantId, slot, `${WEB_URL}/hotels/booking/${slot.id}?payment=return`);
      } catch (err: any) {
        await releasePayment(deps.store, slot);
        throw new HotelOrderError(err?.message ?? "UPI payment could not be started.", err?.status === 503 || err?.status === 400 ? err.status : 502, "UPI_UNAVAILABLE");
      }
      const opened = await deps.store.update(slot.id, { paymentOrderId: pp.id, paymentUrl: pp.url }, { paymentStatus: ["PENDING"] });
      if (opened) await deps.ledger?.(opened, "CHECKOUT_CREATED", { status: "PENDING", amount: opened.amount, gatewayRef: pp.id });
      return c.json({ paymentUrl: pp.url });
    }

    // CARD (Nomod hosted checkout). Claim first so two clicks can't open two charges.
    const slot = await claimPayment(deps.store, order, "NOMOD", null);
    if (!slot) throw new HotelOrderError("A payment for this booking is already in progress.", 409, "PAYMENT_IN_PROGRESS");
    let link: { id: string; url: string };
    try {
      link = await createHotelNomodLink(c.env, tenantId, slot, `${WEB_URL}/hotels/booking/${slot.id}`);
    } catch (err: any) {
      await releasePayment(deps.store, slot);
      throw new HotelOrderError(err?.message ?? "Card payment could not be started.", err?.status === 503 ? 503 : 502, "CARD_UNAVAILABLE");
    }
    const opened = await deps.store.update(slot.id, { paymentOrderId: link.id, paymentUrl: link.url }, { paymentStatus: ["PENDING"] });
    if (opened) await deps.ledger?.(opened, "CHECKOUT_CREATED", { status: "PENDING", amount: opened.amount, gatewayRef: link.id });
    return c.json({ paymentUrl: link.url });
  } catch (err) {
    return orderError(c, err, "Payment could not be started");
  }
});

hotelRoutes.get("/orders/:id/cancel-quote", async (c) => {
  try {
    const deps = await orderDeps(c, 0);
    const order = await refreshOrder(deps, await accessibleOrder(c, deps), true);
    return c.json({ quote: cancelQuote(order), order: publicOrder(order) });
  } catch (err) {
    return orderError(c, err, "Could not load the cancellation terms");
  }
});

hotelRoutes.post("/orders/:id/cancel", zValidator("json", z.object({ confirm: z.literal(true), expectedCharge: z.number().min(0) })), async (c) => {
  const { expectedCharge } = c.req.valid("json");
  try {
    const deps = await orderDeps(c, 15_000);
    const order = await refreshOrder(deps, await accessibleOrder(c, deps), true);
    const result = await cancelOrder(deps, order, expectedCharge);
    return c.json({ order: publicOrder(result) });
  } catch (err) {
    return orderError(c, err, "Could not cancel the hotel booking");
  }
});

hotelRoutes.get("/bookings/:bookingId", async (c) => {
  const { bookingId } = c.req.param();
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    const raw = await logged(c, "/oms/v3/hotel/booking-details", { bookingId }, () => client.bookingDetails(bookingId),
      (r) => ({ status: r?.order?.status }));
    const details = parseHotelBookingDetails(raw);
    // Public by booking ID: status only — guest names stay behind the order key / Admin.
    const { rooms, ...status } = details;
    return c.json({ ...status, rooms: rooms.map((r: { guests: string[] } & Record<string, unknown>) => { const { guests: _guests, ...room } = r; return room; }), pending: !HOTEL_TERMINAL_STATUSES.includes(details.status) });
  } catch (err) {
    return hotelError(c, err, "Could not load the hotel booking");
  }
});

hotelRoutes.get("/nationalities", async (c) => {
  const client = await hotelClient(c.env, c.get("tenantId"), hotelRecorder(c));
  try {
    const res = await logged(c, "/hms/v3/nationality-info", {}, () => client.nationalities(),
      (r) => ({ count: r.nationalityInfos?.length ?? 0 }));
    return c.json({ nationalities: (res.nationalityInfos ?? []).map((n) => ({ code: n.code, countryId: n.countryId, name: n.name, dialCode: n.dialCode })) });
  } catch (err) {
    return hotelError(c, err, "Could not load nationalities");
  }
});
