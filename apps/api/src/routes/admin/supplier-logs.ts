import { parseHotelBookingDetails } from "@tripcod/suppliers";
import { Hono } from "hono";
import { supplierApiLogs, supplierExchanges } from "@tripcod/db/schema";
import { eq, and, desc, gte, inArray, like, lte, or, asc } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { buildZip } from "../../lib/zip.js";
import { certificationRequest, tripjackHost } from "../../lib/certification.js";
import { hotelEnvironment, tripjackEnvironment } from "../../lib/hotels.js";
import {
  hotelBookingFolders, hotelFolderSummary, hotelScenario, hotelStep, hotelZipFileName, storedHotelCalls, type HotelStep, type R2Like, type StoredCall,
} from "../../lib/hotel-cert-logs.js";
import { d1HotelOrderStore } from "../../lib/hotel-order-store.js";
import type { Env, Variables } from "../../types.js";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

export const supplierLogsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

supplierLogsAdminRoutes.get("/", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const role     = c.get("userRole");

  const level    = c.req.query("level");
  const supplier = c.req.query("supplier");
  const endpoint = c.req.query("endpoint");
  const from     = c.req.query("from");
  const to       = c.req.query("to");
  const filterTenantId = c.req.query("tenantId");  // SUPER_ADMIN can filter by any tenant
  const limit    = Math.min(parseInt(c.req.query("limit") ?? "100"), 500);
  const offset   = parseInt(c.req.query("offset") ?? "0");

  // SUPER_ADMIN sees all tenants unless a specific tenantId filter is passed.
  // TENANT_ADMIN is always restricted to their own tenant.
  const conditions: ReturnType<typeof eq>[] = [];
  if (role !== "SUPER_ADMIN") {
    conditions.push(eq(supplierApiLogs.tenantId, tenantId));
  } else if (filterTenantId) {
    conditions.push(eq(supplierApiLogs.tenantId, filterTenantId));
  }

  if (level)    conditions.push(eq(supplierApiLogs.level, level));
  if (supplier) conditions.push(eq(supplierApiLogs.supplier, supplier as "TRIPJACK"));
  if (endpoint) conditions.push(eq(supplierApiLogs.endpoint, endpoint));
  // scope=hotel: every hotel call (TripJack hotel endpoints and rejected hotel requests).
  if (c.req.query("scope") === "hotel") {
    conditions.push(or(like(supplierApiLogs.endpoint, "/hms/%"), like(supplierApiLogs.endpoint, "%/hotel%"), like(supplierApiLogs.endpoint, "hotel %"))!);
  }
  if (from)     conditions.push(gte(supplierApiLogs.createdAt, new Date(from)));
  if (to)       conditions.push(lte(supplierApiLogs.createdAt, new Date(to)));

  try {
    const rows = await db
      .select()
      .from(supplierApiLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(supplierApiLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({ logs: rows, limit, offset });
  } catch (err) {
    console.error("[admin-supplier-logs] query failed:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "Failed to query supplier logs", details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/admin/supplier-logs/export — download TripJack API logs as JSON (UAT submission)
supplierLogsAdminRoutes.get("/export", async (c) => {
  const db       = c.get("db");
  const tenantId = c.get("tenantId");
  const role     = c.get("userRole");
  const supplier = (c.req.query("supplier") ?? "TRIPJACK") as "TRIPJACK" | "RIYA";
  const from     = c.req.query("from");
  const to       = c.req.query("to");
  const filterTenantId = c.req.query("tenantId");

  const conditions: ReturnType<typeof eq>[] = [
    eq(supplierApiLogs.supplier, supplier),
  ];
  if (role !== "SUPER_ADMIN") {
    conditions.push(eq(supplierApiLogs.tenantId, tenantId));
  } else if (filterTenantId) {
    conditions.push(eq(supplierApiLogs.tenantId, filterTenantId));
  }
  if (from) conditions.push(gte(supplierApiLogs.createdAt, new Date(from)));
  if (to)   conditions.push(lte(supplierApiLogs.createdAt, new Date(to)));

  const rows = await db
    .select()
    .from(supplierApiLogs)
    .where(and(...conditions))
    .orderBy(desc(supplierApiLogs.createdAt))
    .limit(500);

  const filename = `${supplier.toLowerCase()}-logs-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), supplier, count: rows.length, logs: rows }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});


// ── Raw request / response files (supplier_exchanges + R2) ──────────────────
// scope: hotel | flight | tripsafe. Requests are shown as TripJack received them
// (TripJack URL, apikey; never our gateway secret); responses exactly as received.

const HOTEL_SCOPE = () => or(like(supplierExchanges.endpoint, "/hms/%"), like(supplierExchanges.endpoint, "/oms/v3/hotel/%"), like(supplierExchanges.endpoint, "/oms/v1/hotel/%"))!;
const scopeFilter = (scope?: string) => scope === "hotel" ? HOTEL_SCOPE()
  : scope === "tripsafe" ? like(supplierExchanges.endpoint, "/insurance/%")
  : scope === "flight" ? or(like(supplierExchanges.endpoint, "/fms/%"), like(supplierExchanges.endpoint, "/oms/v1/air%"), like(supplierExchanges.endpoint, "/oms/v1/booking-details"), like(supplierExchanges.endpoint, "/air-%"), like(supplierExchanges.endpoint, "/v1/air/%"))!
  : undefined;

// TripJack host each call actually went to (the gateway forwards by path).
const isHotelEndpoint = (endpoint: string) =>
  endpoint.startsWith("/hms/") || endpoint.startsWith("/tj-main/hms/") || endpoint.startsWith("/oms/v3/hotel/") || endpoint.startsWith("/oms/v1/hotel/");

export function hostFor(endpoint: string, env: "UAT" | "PRODUCTION") {
  if (endpoint.startsWith("/hms/")) return env === "PRODUCTION" ? "https://hms-search.tripjack.com" : "https://apitest-hms.tripjack.com";
  if (endpoint.startsWith("/oms/v3/hotel/") || endpoint.startsWith("/oms/v1/hotel/")) return env === "PRODUCTION" ? "https://hms-booker.tripjack.com" : "https://apitest-hotel-booker.tripjack.com";
  return tripjackHost(env);
}

// "/hms/v3/hotel/listing" → "HotelListing" (a booking ID in the path is not part of the name)
const serviceName = (endpoint: string) => endpoint.replace(/\/cancel-booking\/.*$/, "/cancel-booking").replace(/^\/(hms|oms|fms)\/v\d+\//, "").split(/[^a-zA-Z0-9]+/).filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") || "Call";

supplierLogsAdminRoutes.get("/exchanges", async (c) => {
  const db = c.get("db");
  const scope = c.req.query("scope");
  const onlyErrors = c.req.query("errors") === "1";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100") || 100, 300);
  const conditions = [eq(supplierExchanges.tenantId, c.get("tenantId"))];
  const sf = scopeFilter(scope);
  if (sf) conditions.push(sf as any);
  const rows = await db.select({
    id: supplierExchanges.id, endpoint: supplierExchanges.endpoint, httpStatus: supplierExchanges.httpStatus,
    durationMs: supplierExchanges.durationMs, error: supplierExchanges.error, bookingId: supplierExchanges.bookingId,
    searchId: supplierExchanges.searchId, requestId: supplierExchanges.requestId, startedAt: supplierExchanges.startedAt,
    responseKey: supplierExchanges.responseKey,
  }).from(supplierExchanges).where(and(...conditions)).orderBy(desc(supplierExchanges.startedAt)).limit(onlyErrors ? 500 : limit);
  const list = rows
    .filter((x) => !onlyErrors || x.error || !x.httpStatus || x.httpStatus >= 400)
    .slice(0, limit)
    .map(({ responseKey, ...x }) => ({ ...x, service: serviceName(x.endpoint), hasResponse: Boolean(responseKey) }));
  return c.json({ exchanges: list });
});

async function exchangeFile(c: any, id: string, part: "request" | "response", baseName?: string) {
  const [x] = await c.get("db").select().from(supplierExchanges)
    .where(and(eq(supplierExchanges.id, id), eq(supplierExchanges.tenantId, c.get("tenantId")))).limit(1);
  const key = part === "request" ? x?.requestKey : x?.responseKey;
  if (!x || !key) return null;
  const obj = await c.env.DOCUMENTS_R2.get(key);
  if (!obj) return null;
  const name = `${baseName ?? serviceName(x.endpoint)}${part === "request" ? "Request" : "Response"}.${key.endsWith(".txt") ? "txt" : "json"}`;
  if (part === "request") {
    let stored: Record<string, any> = {};
    try { stored = JSON.parse(await obj.text()); } catch { /* keep empty */ }
    // Hotels and flights can be on different TripJack environments.
    const env = isHotelEndpoint(x.endpoint) ? await hotelEnvironment(c.env, c.get("tenantId")) : await tripjackEnvironment(c.env, c.get("tenantId"));
    const req = certificationRequest(stored, hostFor(x.endpoint, env));
    // Keep any query string (e.g. city sync cursor); a GET has no body.
    const query = (() => { try { return new URL(String(stored.url)).search; } catch { return ""; } })();
    const body = stored.method === "GET"
      ? { url: `${req.url}${query}`, method: "GET", headers: { ...(req.headers.apikey ? { apikey: req.headers.apikey } : {}) } }
      : req;
    return { name, data: new TextEncoder().encode(JSON.stringify(body, null, 2)), date: x.startedAt as Date };
  }
  return { name, data: new Uint8Array(await obj.arrayBuffer()), date: x.startedAt as Date };
}

supplierLogsAdminRoutes.get("/exchanges.zip", async (c) => {
  const ids = (c.req.query("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (!ids.length) throw new HTTPException(400, { message: "Pass ?ids=" });
  const files: { name: string; data: Uint8Array; date: Date }[] = [];
  const used = new Map<string, number>();
  const rows = await c.get("db").select({ id: supplierExchanges.id }).from(supplierExchanges)
    .where(and(eq(supplierExchanges.tenantId, c.get("tenantId")), inArray(supplierExchanges.id, ids))).orderBy(asc(supplierExchanges.startedAt));
  for (const { id } of rows) {
    for (const part of ["request", "response"] as const) {
      const f = await exchangeFile(c, id, part);
      if (!f) continue;
      // Repeated services get _2, _3 … (e.g. several listing batches).
      const n = (used.get(f.name) ?? 0) + 1;
      used.set(f.name, n);
      files.push({ ...f, name: n > 1 ? f.name.replace(/(\.\w+)$/, `_${n}$1`) : f.name });
    }
  }
  if (!files.length) throw new HTTPException(404, { message: "No log files found" });
  return new Response(buildZip(files), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${c.req.query("name")?.replace(/[^A-Za-z0-9-]+/g, "") || "api-logs"}.zip"`,
    "Cache-Control": "private, no-store",
  } });
});

supplierLogsAdminRoutes.get("/exchanges/:id/:part", async (c) => {
  const part = c.req.param("part");
  if (part !== "request" && part !== "response") throw new HTTPException(400, { message: "part must be request or response" });
  const f = await exchangeFile(c, c.req.param("id"), part);
  if (!f) throw new HTTPException(404, { message: "Log file not found" });
  return new Response(f.data, { headers: {
    "Content-Type": f.name.endsWith(".txt") ? "text/plain; charset=utf-8" : "application/json",
    "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "private, no-store",
  } });
});

// ── Hotel UAT certification packs (one ZIP per TripJack hotel booking) ──────
//
// GET /hotel-certification                 TripJack hotel bookings with stored calls + covered steps
// GET /hotel-certification/:bookingId/zip  every request / response for that booking (and the
//                                          search it came from) + HotelBookingSummary.json
//
// Built from the raw files in R2 (api-logs/<tenant>/booking-<TripJack ID>/ and
// search-<correlationId>/): the Neon index can't hold TripJack hotel booking IDs.

const HOTEL_BOOKING_ID = /^[A-Za-z0-9_-]{3,64}$/;

async function textOf(c: any, key: string | null) {
  if (!key) return "";
  try { return await (await c.env.DOCUMENTS_R2.get(key))?.text() ?? ""; } catch { return ""; }
}

// Calls for one booking: its own folder, plus the search (listing / pricing) and
// the Review that produced the booking ID. Bookings logged before reviews were
// filed under the booking keep their Review in the search folder; it is found by
// its response naming this booking.
export async function collectHotelPack(c: any, bookingId: string) {
  const r2 = c.env.DOCUMENTS_R2 as R2Like;
  const tenantId = c.get("tenantId");
  const own = await storedHotelCalls(r2, tenantId, `booking-${bookingId}`);
  const correlationIds = new Set<string>();
  for (const x of own) if (hotelStep(x.endpoint, null).step === "Review") {
    const corr = (x.request?.body as any)?.correlationId; if (typeof corr === "string") correlationIds.add(corr);
  }
  if (!correlationIds.size && own.length) {
    const first = new Date(own[0].at);
    const reviews = await c.get("db").select({ searchId: supplierExchanges.searchId, responseKey: supplierExchanges.responseKey })
      .from(supplierExchanges)
      .where(and(eq(supplierExchanges.tenantId, tenantId), eq(supplierExchanges.endpoint, "/hms/v3/hotel/review"),
        gte(supplierExchanges.startedAt, new Date(first.getTime() - 6 * 3600_000)), lte(supplierExchanges.startedAt, new Date(first.getTime() + 300_000))))
      .orderBy(desc(supplierExchanges.startedAt)).limit(40);
    for (const r of reviews) {
      if (r.searchId && (await textOf(c, r.responseKey)).includes(bookingId)) { correlationIds.add(r.searchId); break; }
    }
  }
  const search: StoredCall[] = [];
  for (const corr of correlationIds) {
    if (!HOTEL_BOOKING_ID.test(corr)) continue;
    for (const x of await storedHotelCalls(r2, tenantId, `search-${corr}`)) {
      const step = hotelStep(x.endpoint, null).step;
      // Only this booking's Review (a search can review several rooms).
      if (step === "Review" && !(await textOf(c, x.responseKey)).includes(bookingId)) continue;
      search.push(x);
    }
  }
  // Listing calls logged before they were filed by correlationId sit in the
  // browser request's folder: find them by the correlationId in their request body.
  if (correlationIds.size && own.length && !search.some((x) => hotelStep(x.endpoint, null).step === "Search")) {
    const first = new Date(own[0].at);
    const listings = await c.get("db").select({ endpoint: supplierExchanges.endpoint, startedAt: supplierExchanges.startedAt,
      requestKey: supplierExchanges.requestKey, responseKey: supplierExchanges.responseKey })
      .from(supplierExchanges)
      .where(and(eq(supplierExchanges.tenantId, tenantId), eq(supplierExchanges.endpoint, "/hms/v3/hotel/listing"),
        gte(supplierExchanges.startedAt, new Date(first.getTime() - 6 * 3600_000)), lte(supplierExchanges.startedAt, first)))
      .orderBy(desc(supplierExchanges.startedAt)).limit(60);
    for (const l of listings) {
      let request: StoredCall["request"] = null;
      try { request = JSON.parse(await textOf(c, l.requestKey)); } catch { continue; }
      if (!correlationIds.has(String((request?.body as any)?.correlationId ?? ""))) continue;
      search.push({ folder: l.requestKey.split("/").slice(2, 3).join(""), at: new Date(l.startedAt).toISOString(), seq: 0,
        slug: "hms-v3-hotel-listing", requestKey: l.requestKey, responseKey: l.responseKey, endpoint: l.endpoint, request });
    }
  }
  const calls = [...search, ...own].sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
  const steps = new Set<HotelStep>();
  for (const x of calls) steps.add(hotelStep(x.endpoint, x.request?.body).step);
  return { calls, steps, correlationIds: [...correlationIds] };
}

// Fast list: one R2 listing per booking (file names) + its Book request. Search /
// Review of bookings logged before PR #15 live in the search logs; the ZIP adds them.
export async function hotelCertificationList(c: any) {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50") || 50, 100);
  const tenantId = c.get("tenantId");
  const r2 = c.env.DOCUMENTS_R2 as R2Like;
  const store = c.env.HOTEL_DB ? d1HotelOrderStore(c.env.HOTEL_DB, tenantId) : null;
  const packs = [];
  for (const bookingId of await hotelBookingFolders(r2, tenantId)) {
    const summary = await hotelFolderSummary(r2, tenantId, bookingId);
    if (!summary.calls) continue;
    const inSearchLogs = !summary.steps.has("Review");
    if (!inSearchLogs) summary.steps.add("Search");   // the Review's search is in the ZIP
    const scenario = hotelScenario(summary.steps);
    packs.push({
      bookingId, firstCallAt: summary.firstAt, lastCallAt: summary.lastAt!, calls: summary.calls, failedCalls: 0, ...scenario,
      missing: inSearchLogs ? scenario.missing.filter((m) => m !== "Search" && m !== "Review") : scenario.missing,
      searchAndReviewFromSearchLogs: inSearchLogs,
      order: null as null | { id: string; mode: string; status: string; supplierStatus: string | null; hotel: string | null },
    });
  }
  packs.sort((a, b) => b.lastCallAt.localeCompare(a.lastCallAt));
  const page = packs.slice(0, limit);
  for (const p of page) {
    const order = store ? await store.bySupplierBooking(tenantId, p.bookingId).catch(() => null) : null;
    if (order) p.order = { id: order.id, mode: order.mode, status: order.status, supplierStatus: order.supplierStatus, hotel: (order.hotel as any)?.name ?? null };
  }
  return c.json({ packs: page });
}
supplierLogsAdminRoutes.get("/hotel-certification", hotelCertificationList);

// TripJack status in a stored Booking Details response (null when unreadable).
function bookingDetailsStatus(bytes: Uint8Array): string | null {
  try { return parseHotelBookingDetails(JSON.parse(new TextDecoder().decode(bytes))).status || null; } catch { return null; }
}

// Hold evidence for the UAT pack: the Booking Details that showed the hold, and
// the one where TripJack reported it cancelled (after its deadline when no
// Cancellation call was made — TripJack's automatic release).
export function holdLifecycle(calls: { step: string; files: string[]; at: string; supplierStatus?: string }[]) {
  if (!calls.some((x) => x.step === "HoldBook")) return null;
  const evidence = (status: string) => calls.find((x) => x.step === "BookingDetails" && x.supplierStatus === status);
  const held = evidence("ON_HOLD"), cancelled = evidence("CANCELLED");
  const cancelCall = calls.some((x) => x.step === "Cancellation");
  return {
    onHold:    held ? { at: held.at, files: held.files } : null,
    cancelled: cancelled ? { at: cancelled.at, files: cancelled.files } : null,
    outcome:   !cancelled ? (held ? "ON_HOLD" : "UNKNOWN") : cancelCall ? "CANCELLED_ON_REQUEST" : "CANCELLED_BY_TRIPJACK_AFTER_HOLD_DEADLINE",
  };
}

export async function hotelCertificationZip(c: any) {
  const bookingId = c.req.param("bookingId");
  if (!HOTEL_BOOKING_ID.test(bookingId)) throw new HTTPException(400, { message: "Invalid TripJack booking ID" });
  const { calls, steps, correlationIds } = await collectHotelPack(c, bookingId);
  if (!calls.length) throw new HTTPException(404, { message: `No hotel API logs for TripJack booking ${bookingId}` });
  const env = await hotelEnvironment(c.env, c.get("tenantId"));
  const files: { name: string; data: Uint8Array; date: Date }[] = [];
  const used = new Map<string, number>();
  const listed: Record<string, unknown>[] = [];
  const zipCalls: { step: string; requestBody?: unknown; supplierStatus?: string | null }[] = [];
  for (const x of calls) {
    const { step, name } = hotelStep(x.endpoint, x.request?.body);
    // Repeated services get _2, _3 … (several listing batches, status polls).
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    const base = n > 1 ? `${name}_${n}` : name;
    const date = new Date(x.at);
    const written: string[] = [];
    let supplierStatus: string | null = null;
    // Request as TripJack received it (TripJack URL + apikey, never the gateway secret).
    const req = certificationRequest((x.request ?? {}) as Record<string, any>, hostFor(x.endpoint, env));
    const query = (() => { try { return new URL(String(x.request?.url)).search; } catch { return ""; } })();
    const reqBody = x.request?.method === "GET"
      ? { url: `${req.url}${query}`, method: "GET", headers: { ...(req.headers.apikey ? { apikey: req.headers.apikey } : {}) } }
      : req;
    files.push({ name: `${base}Request.json`, data: new TextEncoder().encode(JSON.stringify(reqBody, null, 2)), date });
    written.push(`${base}Request.json`);
    if (x.responseKey) {
      const obj = await c.env.DOCUMENTS_R2.get(x.responseKey);
      if (obj) {
        const fname = `${base}Response.${x.responseKey.endsWith(".txt") ? "txt" : "json"}`;
        const bytes = new Uint8Array(await obj.arrayBuffer());
        files.push({ name: fname, data: bytes, date });   // byte-for-byte as received
        written.push(fname);
        if (step === "BookingDetails") supplierStatus = bookingDetailsStatus(bytes);
      }
    }
    listed.push({ step, service: x.endpoint, at: x.at, folder: x.folder, files: written, ...(supplierStatus ? { supplierStatus } : {}) });
    zipCalls.push({ step, requestBody: x.request?.body, supplierStatus });
  }
  const lifecycle = holdLifecycle(listed as { step: string; files: string[]; at: string; supplierStatus?: string }[]);
  const order = c.env.HOTEL_DB ? await d1HotelOrderStore(c.env.HOTEL_DB, c.get("tenantId")).bySupplierBooking(c.get("tenantId"), bookingId).catch(() => null) : null;
  const summary = {
    tripjackBookingId: bookingId,
    correlationIds,
    environment: env,
    ...hotelScenario(steps),
    ...(lifecycle ? { holdLifecycle: lifecycle } : {}),
    tripcodOrder: order ? {
      id: order.id, mode: order.mode, status: order.status, supplierStatus: order.supplierStatus, confirmationNo: order.confirmationNo,
      holdDeadline: order.holdDeadline, occupancy: order.occupancy, hotel: (order.hotel as any)?.name, amount: order.amount, currency: order.currency,
      payment: order.paymentStatus, cancellation: order.cancellation,
    } : null,
    calls: listed,
    note: "Requests as TripJack received them (TripJack URL + apikey; never the Tripcod gateway secret). Responses byte-for-byte as received.",
  };
  files.push({ name: "HotelBookingSummary.json", data: new TextEncoder().encode(JSON.stringify(summary, null, 2)), date: new Date() });
  return new Response(buildZip(files), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${hotelZipFileName(bookingId, order, zipCalls)}"`,
    "Cache-Control": "private, no-store",
  } });
}
supplierLogsAdminRoutes.get("/hotel-certification/:bookingId/zip", hotelCertificationZip);
