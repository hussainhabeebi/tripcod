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
import { logSupplierCall } from "./supplier-logger.js";

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
  for (const { link, items } of groups.values()) {
    // The R2 folder carries the TripJack booking ID; the Neon index row can't
    // (supplier_exchanges.booking_id references flight bookings). A failed write
    // is reported in Supplier logs instead of disappearing.
    await persistExchanges(env, db, tenantId, items, link, {
      indexBookingId: false,
      onError: (err, x) => logSupplierCall(db, {
        tenantId, supplier: "TRIPJACK", endpoint: x.endpoint, level: "ERROR", errorCode: "RAW_LOG_NOT_STORED",
        errorMessage: `Raw request / response log not stored: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
        requestSummary: { bookingId: link.bookingId, searchId: link.searchId, requestId: link.requestId },
      }),
    });
  }
}

// ── Raw files in R2 (source of truth for certification packs) ───────────────
// Keys: api-logs/<tenant>/<booking-<id>|search-<id>|request-<id>>/<stamp>-<seq>-<slug>-<request|response>.<json|txt>

export interface R2Like {
  list(opts: { prefix: string; delimiter?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; delimitedPrefixes?: string[]; truncated?: boolean; cursor?: string }>;
  get(key: string): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export interface StoredCall {
  folder: string; at: string; seq: number; slug: string;
  requestKey: string; responseKey: string | null;
  endpoint: string;                // gateway path = TripJack path
  request: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown } | null;
}

const FILE = /^(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)-(\d+)-(.+)-(request|response)\.(json|txt)$/;
const stampToIso = (s: string) => s.replace(/^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, "$1:$2:$3.$4Z");
export const isHotelSlug = (slug: string) => slug.startsWith("oms-v3-hotel-") || slug.startsWith("hms-");

async function listAll(r2: R2Like, prefix: string, max = 400) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix, cursor, limit: 500 });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && keys.length < max);
  return keys;
}

// Every hotel call stored in one folder, oldest first, with its request JSON.
export async function storedHotelCalls(r2: R2Like, tenantId: string, folder: string): Promise<StoredCall[]> {
  const prefix = `api-logs/${tenantId}/${folder}/`;
  const byBase = new Map<string, { at: string; seq: number; slug: string; requestKey?: string; responseKey?: string }>();
  for (const key of await listAll(r2, prefix)) {
    const m = FILE.exec(key.slice(prefix.length));
    if (!m || !isHotelSlug(m[3])) continue;
    const base = `${m[1]}-${m[2]}-${m[3]}`;
    const e = byBase.get(base) ?? { at: stampToIso(m[1]), seq: Number(m[2]), slug: m[3] };
    if (m[4] === "request") e.requestKey = key; else e.responseKey = key;
    byBase.set(base, e);
  }
  const calls: StoredCall[] = [];
  for (const e of byBase.values()) {
    if (!e.requestKey) continue;
    let request: StoredCall["request"] = null;
    try { request = JSON.parse(await (await r2.get(e.requestKey))!.text()); } catch { /* unreadable */ }
    let endpoint = "/" + e.slug.replace(/-/g, "/");
    try { if (request?.url) endpoint = new URL(String(request.url)).pathname; } catch { /* keep slug */ }
    calls.push({ folder, at: e.at, seq: e.seq, slug: e.slug, requestKey: e.requestKey, responseKey: e.responseKey ?? null, endpoint, request });
  }
  return calls.sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
}

// TripJack hotel booking folders (flight folders are Tripcod UUIDs).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function hotelBookingFolders(r2: R2Like, tenantId: string, max = 1000): Promise<string[]> {
  const prefix = `api-logs/${tenantId}/booking-`;
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix, delimiter: "/", cursor, limit: 1000 });
    for (const p of page.delimitedPrefixes ?? []) {
      const id = p.slice(prefix.length).replace(/\/$/, "");
      if (ID.test(id) && !UUID.test(id)) ids.push(id);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && ids.length < max);
  return ids;
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
