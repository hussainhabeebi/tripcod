// TripJack Hotel API v3 certification logs.
//
// Every raw hotel exchange is linked to the IDs it carries itself, so a UAT
// scenario can be collected per TripJack booking:
//   listing / pricing          → searchId  = correlationId (request body)
//   review                     → searchId  = correlationId, bookingId = bookingId from the response
//   book / confirm-book /
//   booking-details            → bookingId = request body bookingId
//   cancel-booking/{bookingId} → bookingId from the URL
//
// A booking's pack = its own calls + the listing / pricing calls of the search
// (correlationId) its Review came from.

import type { SupplierExchange } from "@tripcod/suppliers";
import type { Env, Variables } from "../types.js";
import { persistExchanges } from "./api-exchanges.js";

const json = (text: string | null | undefined): any => {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
};
const ID = /^[A-Za-z0-9_-]{3,64}$/;

export function hotelExchangeLink(x: Pick<SupplierExchange, "endpoint" | "url" | "requestBody" | "responseBody">): { bookingId: string | null; searchId: string | null } {
  const body = json(x.requestBody);
  let bookingId: string | null = typeof body?.bookingId === "string" ? body.bookingId : null;
  if (!bookingId) bookingId = /\/cancel-booking\/([A-Za-z0-9_-]+)/.exec(x.url)?.[1] ?? null;
  if (!bookingId && x.endpoint.endsWith("/hotel/review")) {
    const res = json(x.responseBody);
    bookingId = typeof res?.bookingId === "string" ? res.bookingId : null;
  }
  const searchId = typeof body?.correlationId === "string" ? body.correlationId : null;
  return { bookingId: bookingId && ID.test(bookingId) ? bookingId : null, searchId: searchId && ID.test(searchId) ? searchId : null };
}

// Stores hotel exchanges grouped by the IDs each one carries (fallback: the
// handling request's own IDs).
export async function persistHotelExchanges(
  env: Pick<Env, "DOCUMENTS_R2">, db: Variables["db"], tenantId: string, exchanges: SupplierExchange[],
  fallback: { bookingId?: string | null; searchId?: string | null; requestId?: string | null },
): Promise<void> {
  const groups = new Map<string, { link: { bookingId: string | null; searchId: string | null; requestId: string | null }; items: SupplierExchange[] }>();
  for (const x of exchanges) {
    const own = hotelExchangeLink(x);
    const link = { bookingId: own.bookingId ?? fallback.bookingId ?? null, searchId: own.searchId ?? fallback.searchId ?? null, requestId: fallback.requestId ?? null };
    const key = `${link.bookingId}|${link.searchId}`;
    if (!groups.has(key)) groups.set(key, { link, items: [] });
    groups.get(key)!.items.push(x);
  }
  for (const { link, items } of groups.values()) await persistExchanges(env, db, tenantId, items, link);
}

// ── Certification pack ──────────────────────────────────────────────────────

export const HOTEL_STEPS = ["Search", "Review", "InstantBook", "HoldBook", "ConfirmHold", "BookingDetails", "Cancellation"] as const;
export type HotelStep = typeof HOTEL_STEPS[number] | "HotelDetail" | "Other";

// TripJack service → certification step / file name (<Name>Request.json, <Name>Response.json).
export function hotelStep(endpoint: string, requestBody: unknown): { step: HotelStep; name: string } {
  const e = endpoint.replace(/\/cancel-booking\/.*$/, "/cancel-booking");
  if (e === "/hms/v3/hotel/listing") return { step: "Search", name: "HotelSearch" };
  if (e === "/hms/v3/hotel/pricing") return { step: "HotelDetail", name: "HotelDetail" };
  if (e === "/hms/v3/hotel/review") return { step: "Review", name: "HotelReview" };
  if (e === "/oms/v3/hotel/book") {
    const paid = Array.isArray((requestBody as any)?.paymentInfos) && (requestBody as any).paymentInfos.length > 0;
    return paid ? { step: "InstantBook", name: "HotelBook" } : { step: "HoldBook", name: "HotelHoldBook" };
  }
  if (e === "/oms/v3/hotel/confirm-book") return { step: "ConfirmHold", name: "HotelConfirmBook" };
  if (e === "/oms/v3/hotel/booking-details") return { step: "BookingDetails", name: "HotelBookingDetail" };
  if (e === "/oms/v3/hotel/cancel-booking") return { step: "Cancellation", name: "HotelCancelBooking" };
  return { step: "Other", name: e.replace(/^\/(hms|oms)\/v\d+\//, "").split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("") || "Call" };
}

// Which UAT case a booking's calls cover, and what is still missing for it.
export function hotelScenario(steps: Set<HotelStep>) {
  const kind = steps.has("HoldBook") ? (steps.has("ConfirmHold") ? "HOLD_THEN_CONFIRM" : "HOLD") : steps.has("InstantBook") ? "INSTANT" : "REVIEW_ONLY";
  const required: HotelStep[] = ["Search", "Review", "BookingDetails",
    ...(kind === "INSTANT" ? ["InstantBook"] as HotelStep[] : []),
    ...(kind.startsWith("HOLD") ? ["HoldBook"] as HotelStep[] : []),
    ...(kind === "HOLD_THEN_CONFIRM" ? ["ConfirmHold"] as HotelStep[] : [])];
  return {
    scenario: `${kind}${steps.has("Cancellation") ? "_CANCELLED" : ""}`,
    covered: HOTEL_STEPS.filter((s) => steps.has(s)),
    missing: required.filter((s) => !steps.has(s)),
  };
}
