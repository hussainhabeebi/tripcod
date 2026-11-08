// Read-only Admin hotel orders. No supplier refresh or payment operation belongs here.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env, Variables } from "../../types.js";
import { d1HotelOrderStore, rowToOrder } from "../../lib/hotel-order-store.js";
import { publicOrder } from "../../lib/hotel-orders.js";
import { hotelEnvironment } from "../../lib/hotels.js";
import { certificationRequest } from "../../lib/certification.js";
import { collectHotelPack, holdLifecycle, hostFor, hotelCertificationZip } from "./supplier-logs.js";
import { describeHotelResponse, hotelCallLabel, hotelScenario, hotelStep, maskSecret, type HotelStep } from "../../lib/hotel-cert-logs.js";
import { supplierExchanges } from "@tripcod/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export const hotelBookingsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
hotelBookingsAdminRoutes.use("*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
const tenant = (c: any) => c.get("userRole") === "SUPER_ADMIN" ? c.req.query("tenantId") : c.get("tenantId");
const number = (v: string | undefined, fallback: number, max: number) => Math.min(Math.max(Number.parseInt(v ?? "", 10) || fallback, 0), max);
function view(o: any) { return { ...publicOrder(o), tenantId: o.tenantId, userId: o.userId, contactPhone: o.contactPhone, dialCode: o.dialCode, lastError: o.lastError, paymentOrderId: o.paymentOrderId, paymentRef: o.paymentRef }; }
async function order(c: any) {
  if (!c.env.HOTEL_DB) throw new HTTPException(503, { message: "Hotel order storage is unavailable" });
  const o = await d1HotelOrderStore(c.env.HOTEL_DB, tenant(c)).get(c.req.param("id"));
  if (!o) throw new HTTPException(404, { message: "Hotel booking not found" });
  // SUPER_ADMIN may inspect a different tenant; logs must use that order's tenant.
  c.set("tenantId", o.tenantId);
  return o;
}
hotelBookingsAdminRoutes.get("/", async (c) => {
  if (!c.env.HOTEL_DB) throw new HTTPException(503, { message: "Hotel order storage is unavailable" });
  const clauses: string[] = [], args: unknown[] = [];
  const t = tenant(c);
  for (const [column, value] of [["tenant_id", t], ["status", c.req.query("status")], ["supplier_booking_id", c.req.query("pnr")]] as const) {
    if (value) { clauses.push(`${column} = ?`); args.push(value); }
  }
  const limit = number(c.req.query("limit"), 50, 200), offset = number(c.req.query("offset"), 0, 100000);
  const rows = await c.env.HOTEL_DB.prepare(`SELECT * FROM hotel_bookings${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all<Record<string, unknown>>();
  return c.json({ bookings: rows.results.map((r) => view(rowToOrder(r))), total: rows.results.length });
});
hotelBookingsAdminRoutes.get("/:id", async (c) => c.json({ booking: view(await order(c)) }));
// Every stored TripJack call for this booking, oldest first, with what Admin needs
// to read it at a glance. The stored request / response files are not changed.
hotelBookingsAdminRoutes.get("/:id/exchanges", async (c) => {
  const o = await order(c);
  const { calls, steps } = await collectHotelPack(c, o.supplierBookingId);
  const keys = calls.map((x) => x.requestKey);
  // Index rows (status, duration, request ID) are optional: older calls only have their R2 files.
  let rows: any[] = [];
  try {
    const found = keys.length ? await c.get("db").select({
      requestKey: supplierExchanges.requestKey, httpStatus: supplierExchanges.httpStatus, durationMs: supplierExchanges.durationMs,
      error: supplierExchanges.error, requestId: supplierExchanges.requestId,
    }).from(supplierExchanges).where(and(eq(supplierExchanges.tenantId, o.tenantId), inArray(supplierExchanges.requestKey, keys))) : [];
    if (Array.isArray(found)) rows = found;
  } catch (err) { console.error("[admin-hotel-logs] exchange index unavailable", err); }
  const index = new Map(rows.map((r: any) => [r.requestKey, r]));
  const exchanges = [];
  for (const [i, x] of calls.entries()) {
    const { step, name } = hotelStep(x.endpoint, x.request?.body);
    const row: any = index.get(x.requestKey) ?? {};
    const object: any = x.responseKey ? await c.env.DOCUMENTS_R2.get(x.responseKey) : null;
    const text = object ? await object.text() : null;
    const meta = object?.customMetadata ?? {};
    let headers: Record<string, string> = {};
    try { headers = JSON.parse(meta.responseHeaders ?? "{}"); } catch { /* none */ }
    const httpStatus = typeof row.httpStatus === "number" ? row.httpStatus : /^\d{3}$/.test(meta.httpStatus ?? "") ? Number(meta.httpStatus) : null;
    exchanges.push({
      id: i, step, label: hotelCallLabel(step, x.endpoint), name, endpoint: x.endpoint, startedAt: x.at,
      httpStatus, durationMs: row.durationMs ?? null, transportError: row.error ?? null,
      gatewayRequestId: headers["x-request-id"] ?? null, requestId: row.requestId ?? null,
      hasResponse: Boolean(object), ...describeHotelResponse(step, httpStatus, text),
    });
  }
  const covered = hotelScenario(steps as Set<HotelStep>);
  return c.json({
    exchanges,
    certification: { ...covered, holdLifecycle: holdLifecycle(exchanges.map((x) => ({ step: x.step, at: x.startedAt, files: [], supplierStatus: x.supplierStatus ?? undefined }))) },
  });
});
hotelBookingsAdminRoutes.get("/:id/exchanges/:index/:part", async (c) => {
  const o = await order(c);
  const { calls } = await collectHotelPack(c, o.supplierBookingId);
  const index = c.req.param("index"), part = c.req.param("part");
  if (!/^\d+$/.test(index) || !["request", "response"].includes(part)) throw new HTTPException(400, { message: "Invalid log selection" });
  const call = calls[Number(index)];
  if (!call) throw new HTTPException(404, { message: "Hotel log not found" });
  let data: string;
  if (part === "request") {
    // Admin view / download: the API key is masked. The certification ZIP keeps the exact request.
    const request = certificationRequest(call.request ?? {}, hostFor(call.endpoint, await hotelEnvironment(c.env, o.tenantId)));
    const headers = request.headers.apikey ? { ...request.headers, apikey: maskSecret(String(request.headers.apikey)) } : request.headers;
    const query = (() => { try { return new URL(String(call.request?.url)).search; } catch { return ""; } })();
    data = JSON.stringify(call.request?.method === "GET" ? { url: `${request.url}${query}`, method: "GET", headers: headers.apikey ? { apikey: headers.apikey } : {} } : { ...request, headers }, null, 2);
  }
  else {
    const object = call.responseKey ? await c.env.DOCUMENTS_R2.get(call.responseKey) : null;
    if (!object) throw new HTTPException(404, { message: "Response not stored" });
    data = await object.text();
  }
  const name = `${o.supplierBookingId}-${String(Number(index) + 1).padStart(2, "0")}-${hotelStep(call.endpoint, call.request?.body).name}${part === "request" ? "Request" : "Response"}.json`;
  return new Response(data, { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${name}"` } });
});
hotelBookingsAdminRoutes.get("/:id/certification.zip", async (c) => {
  const o = await order(c);
  // Reuse the existing certification exporter, including legacy search/review linkage.
  const request = new Request(`https://internal/hotel-certification/${encodeURIComponent(o.supplierBookingId)}/zip`);
  const app = new Hono<any>();
  app.use("*", async (inner, next) => { inner.set("tenantId", o.tenantId); inner.set("db", c.get("db")); await next(); });
  app.get("/hotel-certification/:bookingId/zip", hotelCertificationZip);
  return app.fetch(request, c.env, c.executionCtx);
});
