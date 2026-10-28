// Postgres store for website hotel orders (hotel_bookings) and the wiring of
// hotel-orders.ts to the real TripJack client, payment refunds and the queue.

import type { Db } from "@tripcod/db";
import { hotelBookings } from "@tripcod/db/schema";
import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { Env } from "../types.js";
import type { HotelOrder, HotelOrderDeps, HotelOrderStore, OrderGuard } from "./hotel-orders.js";
import { creditWallet, getOrCreateCustomerWallet } from "./customer-wallet.js";
import { refundNomodCharge, resolveNomodApiKey } from "./payment-gateway.js";
import { logSupplierCall } from "./supplier-logger.js";
import { hotelClient } from "./hotels.js";
import type { ExchangeRecorder } from "@tripcod/suppliers";

export function dbHotelOrderStore(db: Db, tenantId?: string): HotelOrderStore {
  const scoped = (cond: SQL) => tenantId ? and(cond, eq(hotelBookings.tenantId, tenantId))! : cond;
  return {
    async insert(row) {
      const [created] = await db.insert(hotelBookings).values(row).onConflictDoNothing().returning();
      return created ?? null;
    },
    async get(id) {
      const [row] = await db.select().from(hotelBookings).where(scoped(eq(hotelBookings.id, id))).limit(1);
      return row ?? null;
    },
    async bySupplierBooking(tenant, supplierBookingId) {
      const [row] = await db.select().from(hotelBookings)
        .where(and(eq(hotelBookings.tenantId, tenant), eq(hotelBookings.supplierBookingId, supplierBookingId))).limit(1);
      return row ?? null;
    },
    async byPaymentOrder(ids) {
      if (!ids.length) return null;
      const [row] = await db.select().from(hotelBookings).where(inArray(hotelBookings.paymentOrderId, ids)).limit(1);
      return row ?? null;
    },
    async listByUser(tenant, userId) {
      return db.select().from(hotelBookings)
        .where(and(eq(hotelBookings.tenantId, tenant), eq(hotelBookings.userId, userId)))
        .orderBy(desc(hotelBookings.createdAt)).limit(100);
    },
    async update(id, patch, guard?: OrderGuard) {
      const conds: SQL[] = [eq(hotelBookings.id, id)];
      if (guard?.status) conds.push(inArray(hotelBookings.status, guard.status));
      if (guard?.paymentStatus) conds.push(inArray(hotelBookings.paymentStatus, guard.paymentStatus));
      if (guard?.supplierSubmittedAtNull) conds.push(isNull(hotelBookings.supplierSubmittedAt));
      if (guard?.confirmSubmittedAtNull) conds.push(isNull(hotelBookings.confirmSubmittedAt));
      const [row] = await db.update(hotelBookings).set({ ...patch, updatedAt: new Date() })
        .where(scoped(and(...conds)!)).returning();
      return row ?? null;
    },
  };
}

// Full refund of a captured hotel payment to where it came from.
export async function refundHotelPayment(env: Env, db: Db, order: HotelOrder, amount: number, reason: string): Promise<{ ok: boolean; note: string }> {
  if (order.paymentGateway === "WALLET" && order.userId) {
    const wallet = await getOrCreateCustomerWallet(db, order.tenantId, order.userId);
    await creditWallet(db, wallet.id, amount, "REFUND_CREDIT", {
      bookingId: order.id, paymentId: `hotel_refund_${order.id}`, note: `Refund for hotel booking ${order.supplierBookingId}`,
    });
    return { ok: true, note: `${order.currency} ${amount.toFixed(2)} returned to the Tripcod wallet.` };
  }
  if (order.paymentGateway === "NOMOD" && order.paymentRef) {
    const apiKey = await resolveNomodApiKey(env, order.tenantId);
    if (!apiKey) return { ok: false, note: "Card refund needs the team: Nomod is not configured." };
    const outcome = await refundNomodCharge(apiKey, order.paymentRef, amount, reason.slice(0, 120));
    if (outcome.ok) return { ok: true, note: `Card refund ${outcome.refundId} issued via Nomod.` };
    return { ok: false, note: `Card refund needs the team: ${outcome.error}` };
  }
  return { ok: false, note: "Refund needs the team (no automatic refund route for this payment)." };
}

// Supplier-call logger usable outside a request (queue).
export function supplierCall(db: Db, tenantId: string, waitUntil?: (p: Promise<unknown>) => void): HotelOrderDeps["call"] {
  return async (endpoint, summary, fn) => {
    const started = Date.now();
    const requestId = `hotel-order-${crypto.randomUUID()}`;
    try {
      const result = await fn();
      const log = logSupplierCall(db, { tenantId, supplier: "TRIPJACK", endpoint, level: "INFO", httpStatus: 200, requestId, requestSummary: summary, durationMs: Date.now() - started });
      if (waitUntil) waitUntil(log); else await log;
      return result;
    } catch (err: any) {
      await logSupplierCall(db, {
        tenantId, supplier: "TRIPJACK", endpoint, level: "ERROR", requestId,
        httpStatus: typeof err?.statusCode === "number" ? err.statusCode : undefined,
        errorCode: String(err?.code ?? "HOTEL_API_ERROR"), errorMessage: String(err?.message ?? err).slice(0, 500),
        responseSnippet: typeof err?.responseSnippet === "string" ? err.responseSnippet : undefined,
        requestSummary: summary, durationMs: Date.now() - started,
      });
      throw err;
    }
  };
}

export interface HotelQueueMsg { type: "HOTEL_PAYMENT_CAPTURED"; hotelBookingId: string; tenantId: string }

export async function hotelOrderDeps(env: Env, db: Db, tenantId: string, opts: { recorder?: ExchangeRecorder; waitUntil?: (p: Promise<unknown>) => void; pollMs?: number } = {}): Promise<HotelOrderDeps> {
  return {
    store:   dbHotelOrderStore(db, tenantId),
    client:  await hotelClient(env, tenantId, opts.recorder),
    call:    supplierCall(db, tenantId, opts.waitUntil),
    refund:  (order, amount, reason) => refundHotelPayment(env, db, order, amount, reason),
    enqueue: async (id) => { await env.BOOKING_QUEUE.send({ type: "HOTEL_PAYMENT_CAPTURED", hotelBookingId: id, tenantId } satisfies HotelQueueMsg); },
    pollMs:  opts.pollMs,
  };
}

// ── Card payment (the tenant's existing Nomod setup — same settings as flights) ──

async function paymentSettings(env: Env, tenantId: string): Promise<Record<string, any> | null> {
  try {
    const raw = await env.TENANT_CACHE_KV.get(`admin_settings:${tenantId}:payments`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function cardPaymentAvailable(env: Env, tenantId: string): Promise<boolean> {
  const settings = await paymentSettings(env, tenantId);
  return Boolean(settings?.nomod?.enabled && (settings.nomod.apiKey || env.NOMOD_API_KEY));
}

export async function createHotelNomodLink(env: Env, tenantId: string, order: HotelOrder, returnUrl: string): Promise<{ id: string; url: string }> {
  const settings = await paymentSettings(env, tenantId);
  const apiKey = settings?.nomod?.apiKey || env.NOMOD_API_KEY;
  if (!settings?.nomod?.enabled || !apiKey) throw Object.assign(new Error("Card payment is not available right now."), { status: 503 });
  const hotel = order.hotel as { name?: string };
  const amount = Number(order.amount).toFixed(2);
  const res = await fetch("https://api.nomod.com/v1/links", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({
      currency: order.currency,
      items: [{ name: `Hotel: ${(hotel.name ?? "stay").slice(0, 60)} (${order.supplierBookingId})`, amount, quantity: 1 }],
      title: "Tripcod hotel booking",
      note: `Payment for hotel booking ${order.supplierBookingId}`,
      shipping_address_required: false,
      allow_tip: false,
      allow_tabby: settings.nomod.allowTabby ?? true,
      allow_tamara: settings.nomod.allowTamara ?? true,
      allow_service_fee: false,
      payment_expiry_limit: 1,
      success_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}payment=success`,
      failure_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}payment=failed`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await res.text();
  let link: { id?: string; url?: string; error?: { message?: string } } = {};
  try { link = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON */ }
  if (!res.ok || !link.id || !link.url) {
    throw Object.assign(new Error(`Card payment could not be started: ${link.error?.message || raw.slice(0, 200) || `HTTP ${res.status}`}`), { status: 502 });
  }
  return { id: link.id, url: link.url };
}

// ── Queue + Nomod webhook entry points ───────────────────────────────────────

export async function processHotelPayment(env: Env, db: Db, msg: HotelQueueMsg) {
  const { processPaidOrder } = await import("./hotel-orders.js");
  const deps = await hotelOrderDeps(env, db, msg.tenantId, { pollMs: 60_000 });
  const order = await processPaidOrder(deps, msg.hotelBookingId);
  console.info(`[hotel-order] ${msg.hotelBookingId} after payment: ${order?.status ?? "missing"} / ${order?.supplierStatus ?? "-"}`);
}

// Nomod charge events for hotel orders. Returns null when no hotel order uses these ids.
export async function handleHotelNomodEvent(env: Env, db: Db, type: string, chargeId: string | undefined, candidates: string[]) {
  const order = await dbHotelOrderStore(db).byPaymentOrder(candidates);
  if (!order || order.paymentGateway !== "NOMOD") return null;
  const { recordPaid } = await import("./hotel-orders.js");
  const store = dbHotelOrderStore(db, order.tenantId);
  if (type === "charge.completed") {
    if (order.paymentStatus !== "PENDING") return { hotelOrder: order.id, duplicate: true };
    await recordPaid({
      store,
      enqueue: async (id) => { await env.BOOKING_QUEUE.send({ type: "HOTEL_PAYMENT_CAPTURED", hotelBookingId: id, tenantId: order.tenantId } satisfies HotelQueueMsg); },
    }, order, chargeId ?? order.paymentOrderId ?? "");
    return { hotelOrder: order.id, paid: true };
  }
  if (type === "charge.refunded" && order.paymentStatus === "REFUND_PENDING") {
    await store.update(order.id, { paymentStatus: "REFUNDED" }, { paymentStatus: ["REFUND_PENDING"] });
    return { hotelOrder: order.id, refunded: true };
  }
  // A failed / cancelled attempt keeps the link on the order: the customer can retry
  // on the same link, and a later success still maps to this booking.
  return { hotelOrder: order.id, ignored: type };
}
