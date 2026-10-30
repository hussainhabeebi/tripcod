// Admin → Transactions (mounted at /api/admin/finance/payments, so finance staff
// can read it). Refunds and re-checks need a full admin.
//
//   GET  /events                 payment ledger (filters: gateway, product, event, q)
//   GET  /                       payments with their flight / hotel reference
//   GET  /hotel-orders           website hotel orders (D1) with their payment state
//   GET  /:id                    one payment + its ledger
//   POST /:id/refund             refund (full or partial) through the original gateway
//   POST /:id/reconcile          re-check a pending PhonePe order with PhonePe
//   POST /hotel-orders/:id/refresh  re-check a hotel order's payment (PhonePe) and TripJack status

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { paymentEvents, payments, bookings } from "@tripcod/db/schema";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";
import { requireRole } from "../../middleware/auth.js";
import { refundPayment, tenantOf } from "../../lib/payment-core.js";
import { gatewayAvailability, reconcilePhonePe, tenantPaymentSettings } from "../../lib/checkout-gateways.js";
import { refreshOrder } from "../../lib/hotel-orders.js";
import { hotelOrderDeps, rowToOrder } from "../../lib/hotel-order-store.js";
import { missingPhonePeSecrets, phonePeEnvironment } from "../../lib/phonepe.js";

export const paymentsAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const limitOf = (v: string | undefined) => Math.min(Math.max(Number(v) || 50, 1), 200);
// Platform super-admins see every tenant; everyone else only their own.
const scoped = (c: any) => c.get("userRole") === "SUPER_ADMIN" ? null : c.get("tenantId") as string;

paymentsAdminRoutes.get("/status", async (c) => {
  const settings = await tenantPaymentSettings(c.env, c.get("tenantId"));
  const avail = gatewayAvailability(c.env, settings);
  return c.json({
    nomod:   { enabled: Boolean(settings?.nomod?.enabled), available: avail.NOMOD, webhookSecretSet: Boolean(c.env.NOMOD_WEBHOOK_SECRET) },
    phonepe: { enabled: Boolean(settings?.phonepe?.enabled), available: avail.PHONEPE, environment: phonePeEnvironment(c.env), missingSecrets: missingPhonePeSecrets(c.env) },
    webhooks: { nomod: "/webhooks/nomod", phonepe: "/webhooks/phonepe" },
  });
});

paymentsAdminRoutes.get("/events", async (c) => {
  const db = c.get("db");
  const q = c.req.query();
  const where: SQL[] = [];
  const tenant = scoped(c);
  if (tenant) where.push(eq(paymentEvents.tenantId, tenant));
  if (q.gateway) where.push(sql`${paymentEvents.gateway} = ${q.gateway}`);
  if (q.product) where.push(eq(paymentEvents.product, q.product));
  if (q.event) where.push(eq(paymentEvents.event, q.event));
  if (q.paymentId) where.push(eq(paymentEvents.paymentId, q.paymentId));
  if (q.q) where.push(or(ilike(paymentEvents.referenceId, `${q.q}%`), ilike(paymentEvents.gatewayRef, `%${q.q}%`), eq(paymentEvents.paymentId, q.q))!);
  const rows = await db.select().from(paymentEvents).where(where.length ? and(...where) : undefined)
    .orderBy(desc(paymentEvents.createdAt)).limit(limitOf(q.limit)).offset(Math.max(Number(q.offset) || 0, 0));
  return c.json({ events: rows });
});

const adminHotelOrder = (o: ReturnType<typeof rowToOrder>) => ({
  id: o.id, status: o.status, supplierStatus: o.supplierStatus, supplierBookingId: o.supplierBookingId, mode: o.mode,
  hotelName: (o.hotel as { name?: string } | null)?.name ?? null, amount: Number(o.amount), currency: o.currency,
  paymentStatus: o.paymentStatus, paymentGateway: o.paymentGateway, paymentOrderId: o.paymentOrderId, paymentRef: o.paymentRef,
  refundAmount: o.refundAmount, refundNote: o.refundNote, contactEmail: o.contactEmail, lastError: o.lastError, createdAt: o.createdAt,
});

paymentsAdminRoutes.get("/hotel-orders", async (c) => {
  const status = c.req.query("paymentStatus");
  const { results } = await c.env.HOTEL_DB
    .prepare(`SELECT * FROM hotel_bookings WHERE tenant_id = ?${status ? " AND payment_status = ?" : ""} ORDER BY created_at DESC LIMIT ?`)
    .bind(...[c.get("tenantId"), ...(status ? [status] : []), limitOf(c.req.query("limit"))]).all<Record<string, unknown>>();
  return c.json({ orders: results.map((r) => adminHotelOrder(rowToOrder(r))) });
});

paymentsAdminRoutes.post("/hotel-orders/:id/refresh", async (c) => {
  requireRole("SUPER_ADMIN", "TENANT_ADMIN")(c.get("userRole"));
  const deps = await hotelOrderDeps(c.env, c.get("db"), c.get("tenantId"));
  const o = await deps.store.get(c.req.param("id"));
  if (!o) throw new HTTPException(404, { message: "Hotel order not found" });
  return c.json({ order: adminHotelOrder(await refreshOrder(deps, o, true)) });
});

paymentsAdminRoutes.get("/", async (c) => {
  const db = c.get("db");
  const q = c.req.query();
  const where: SQL[] = [sql`${payments.gateway} IN ('NOMOD', 'PHONEPE', 'RAZORPAY')`];
  if (q.gateway) where.push(sql`${payments.gateway} = ${q.gateway}`);
  if (q.status) where.push(sql`${payments.status} = ${q.status}`);
  // Flight payments only (hotel order payments live in D1: see /hotel-orders).
  if (q.product === "HOTEL") return c.json({ payments: [] });
  const tenant = scoped(c);
  if (tenant) where.push(eq(bookings.tenantId, tenant));
  const rows = await db.select({
    id: payments.id, gateway: payments.gateway, environment: payments.environment, status: payments.status,
    amount: payments.amount, currency: payments.currency, gatewayOrderId: payments.gatewayOrderId, gatewayPaymentId: payments.gatewayPaymentId,
    refundedAmount: payments.refundedAmount, refundGatewayRef: payments.refundGatewayRef, refundInitiatedAt: payments.refundInitiatedAt, refundCompletedAt: payments.refundCompletedAt,
    bookingId: payments.bookingId, createdAt: payments.createdAt, updatedAt: payments.updatedAt,
    bookingStatus: bookings.status, route: sql<string | null>`${bookings.origin} || '→' || ${bookings.destination}`, pnr: bookings.pnr,
  }).from(payments)
    .leftJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(and(...where)).orderBy(desc(payments.createdAt)).limit(limitOf(q.limit)).offset(Math.max(Number(q.offset) || 0, 0));
  return c.json({ payments: rows.map((r) => ({ ...r, product: "FLIGHT" })) });
});

async function loadPayment(c: any, id: string) {
  const db = c.get("db");
  const [p] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  if (!p) throw new HTTPException(404, { message: "Payment not found" });
  const tenant = scoped(c);
  if (tenant && (await tenantOf(db, p)) !== tenant) throw new HTTPException(404, { message: "Payment not found" });
  return p as typeof payments.$inferSelect;
}

paymentsAdminRoutes.get("/:id", async (c) => {
  const p = await loadPayment(c, c.req.param("id"));
  const events = await c.get("db").select().from(paymentEvents).where(eq(paymentEvents.paymentId, p.id)).orderBy(desc(paymentEvents.createdAt)).limit(200);
  return c.json({ payment: { ...p, product: "FLIGHT" }, events });
});

paymentsAdminRoutes.post("/:id/refund", zValidator("json", z.object({
  amount: z.number().positive().optional(),
  reason: z.string().min(3).max(200),
})), async (c) => {
  requireRole("SUPER_ADMIN", "TENANT_ADMIN")(c.get("userRole"));
  const { amount, reason } = c.req.valid("json");
  const p = await loadPayment(c, c.req.param("id"));
  if (!["SUCCESS", "PARTIAL_REFUND"].includes(p.status) && !(p.status === "PENDING" && p.gatewayPaymentId)) {
    throw new HTTPException(409, { message: `A ${p.status} payment can't be refunded` });
  }
  const left = Number(p.amount) - Number(p.refundedAmount ?? 0);
  if (amount !== undefined && amount > left + 0.009) throw new HTTPException(400, { message: `At most ${p.currency} ${left.toFixed(2)} can be refunded` });
  const out = await refundPayment(c.get("db"), c.env, p, { amount, reason, actor: c.get("userId") ?? "admin" });
  if (!out.ok) throw new HTTPException(out.skipped ? 409 : 502, { message: out.error });
  return c.json({ ok: true, refundRef: out.refundRef, pending: out.pending });
});

paymentsAdminRoutes.post("/:id/reconcile", async (c) => {
  requireRole("SUPER_ADMIN", "TENANT_ADMIN")(c.get("userRole"));
  const p = await loadPayment(c, c.req.param("id"));
  if (p.gateway !== "PHONEPE") throw new HTTPException(400, { message: "Only PhonePe orders can be re-checked here (Nomod confirms by webhook)" });
  const outcome = await reconcilePhonePe(c.get("db"), c.env, p, "ADMIN_RECHECK");
  return c.json({ outcome });
});
