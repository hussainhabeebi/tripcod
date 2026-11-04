// Cloudflare D1 store for website hotel orders (hotel_bookings, see
// apps/api/d1-migrations) and the wiring of hotel-orders.ts to the real TripJack
// client, payment refunds and the queue.
//
// Money and customers stay in Neon (wallet, users, supplier logs). D1 rows keep
// the Neon tenant / user ids and the wallet ledger's payment_id refs, so each
// side can be matched to the other; see reconcileWalletPayment.

import type { D1Database } from "@cloudflare/workers-types";
import type { Db } from "@tripcod/db";
import { walletTransactions } from "@tripcod/db/schema";
import { eq } from "drizzle-orm";
import type { Env } from "../types.js";
import type { HotelOrder, HotelOrderDeps, HotelOrderStore, OrderGuard } from "./hotel-orders.js";
import { creditWallet, getOrCreateCustomerWallet } from "./customer-wallet.js";
import { refundNomodCharge, resolveNomodApiKey } from "./payment-gateway.js";
import {
  createPhonePePayment, merchantOrderEnvironment, newMerchantOrderId, phonePeOrderStatus, refundPhonePe, resolvePhonePeConfig, toPaise,
} from "./phonepe.js";
import { logPaymentEvent } from "./payment-core.js";
import { gatewayAvailability, tenantPaymentSettings } from "./checkout-gateways.js";
import { logSupplierCall } from "./supplier-logger.js";
import { hotelClient } from "./hotels.js";
import { collectExchanges } from "./api-exchanges.js";
import { persistHotelExchanges } from "./hotel-cert-logs.js";
import type { ExchangeRecorder } from "@tripcod/suppliers";

// camelCase field → column. JSON and timestamp columns are converted both ways.
const COLUMNS: Record<string, string> = {
  id: "id", tenantId: "tenant_id", userId: "user_id", supplierBookingId: "supplier_booking_id", mode: "mode", status: "status",
  supplierStatus: "supplier_status", confirmationNo: "confirmation_no", holdDeadline: "hold_deadline", hotel: "hotel",
  occupancy: "occupancy", guests: "guests", option: "option", nationality: "nationality", amount: "amount", currency: "currency",
  contactEmail: "contact_email", contactPhone: "contact_phone", dialCode: "dial_code", paymentStatus: "payment_status",
  paymentGateway: "payment_gateway", paymentOrderId: "payment_order_id", paymentRef: "payment_ref", paymentUrl: "payment_url",
  paidAt: "paid_at", refundAmount: "refund_amount", refundNote: "refund_note", supplierSubmittedAt: "supplier_submitted_at",
  confirmSubmittedAt: "confirm_submitted_at", cancellation: "cancellation", accessKeyHash: "access_key_hash",
  lastError: "last_error", lastCheckedAt: "last_checked_at", createdAt: "created_at", updatedAt: "updated_at",
};
const JSON_FIELDS = new Set(["hotel", "occupancy", "guests", "option", "cancellation"]);
const DATE_FIELDS = new Set(["paidAt", "supplierSubmittedAt", "confirmSubmittedAt", "lastCheckedAt", "createdAt", "updatedAt"]);

function toColumn(field: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (JSON_FIELDS.has(field)) return JSON.stringify(value);
  if (DATE_FIELDS.has(field)) return value instanceof Date ? value.toISOString() : String(value);
  return value;
}

export function rowToOrder(row: Record<string, unknown>): HotelOrder {
  const out: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(COLUMNS)) {
    const v = row[column];
    out[field] = v === null || v === undefined ? null
      : JSON_FIELDS.has(field) ? JSON.parse(String(v))
      : DATE_FIELDS.has(field) ? new Date(String(v))
      : v;
  }
  return out as unknown as HotelOrder;
}

const inList = (values: string[]) => values.map(() => "?").join(", ");

export function d1HotelOrderStore(d1: D1Database, tenantId?: string): HotelOrderStore {
  const tenantClause = tenantId ? " AND tenant_id = ?" : "";
  const tenantArgs = tenantId ? [tenantId] : [];
  const one = async (sql: string, ...args: unknown[]) => {
    const row = await d1.prepare(sql).bind(...args).first<Record<string, unknown>>();
    return row ? rowToOrder(row) : null;
  };
  return {
    async insert(row) {
      const now = new Date().toISOString();
      const full: Record<string, unknown> = { ...row, id: crypto.randomUUID(), paymentStatus: "UNPAID", createdAt: now, updatedAt: now };
      const fields = Object.keys(full).filter((f) => COLUMNS[f]);
      // A second order for the same TripJack booking (or payment ref) inserts nothing.
      return one(`INSERT INTO hotel_bookings (${fields.map((f) => COLUMNS[f]).join(", ")}) VALUES (${inList(fields)})
        ON CONFLICT DO NOTHING RETURNING *`, ...fields.map((f) => toColumn(f, full[f])));
    },
    get: (id) => one(`SELECT * FROM hotel_bookings WHERE id = ?${tenantClause}`, id, ...tenantArgs),
    bySupplierBooking: (tenant, supplierBookingId) =>
      one("SELECT * FROM hotel_bookings WHERE tenant_id = ? AND supplier_booking_id = ?", tenant, supplierBookingId),
    async byPaymentOrder(ids) {
      if (!ids.length) return null;
      return one(`SELECT * FROM hotel_bookings WHERE payment_order_id IN (${inList(ids)}) LIMIT 1`, ...ids);
    },
    async listByUser(tenant, userId) {
      const { results } = await d1.prepare("SELECT * FROM hotel_bookings WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100")
        .bind(tenant, userId).all<Record<string, unknown>>();
      return results.map(rowToOrder);
    },
    // Conditional update: the guard is part of the WHERE clause, so concurrent
    // claims (payment slot, supplier submission) can't both succeed.
    async update(id, patch, guard?: OrderGuard) {
      const fields = Object.keys(patch).filter((f) => COLUMNS[f] && f !== "id" && f !== "tenantId" && f !== "createdAt");
      const sets = [...fields.map((f) => `${COLUMNS[f]} = ?`), "updated_at = ?"];
      const args: unknown[] = [...fields.map((f) => toColumn(f, (patch as Record<string, unknown>)[f])), new Date().toISOString()];
      const where = ["id = ?"]; args.push(id);
      if (tenantId) { where.push("tenant_id = ?"); args.push(tenantId); }
      if (guard?.status) { where.push(`status IN (${inList(guard.status)})`); args.push(...guard.status); }
      if (guard?.paymentStatus) { where.push(`payment_status IN (${inList(guard.paymentStatus)})`); args.push(...guard.paymentStatus); }
      if (guard?.supplierSubmittedAtNull) where.push("supplier_submitted_at IS NULL");
      if (guard?.confirmSubmittedAtNull) where.push("confirm_submitted_at IS NULL");
      if (guard && "lastCheckedAt" in guard) { where.push("last_checked_at IS ?"); args.push(toColumn("lastCheckedAt", guard.lastCheckedAt)); }
      return one(`UPDATE hotel_bookings SET ${sets.join(", ")} WHERE ${where.join(" AND ")} RETURNING *`, ...args);
    },
  };
}

// Has the Neon wallet ledger got this debit / credit reference? (cross-database link)
export async function walletTxExists(db: Db, paymentId: string): Promise<boolean> {
  const [row] = await db.select({ id: walletTransactions.id }).from(walletTransactions).where(eq(walletTransactions.paymentId, paymentId)).limit(1);
  return Boolean(row);
}

// Full refund of a captured hotel payment to where it came from.
export async function refundHotelPayment(env: Env, db: Db, order: HotelOrder, amount: number, reason: string): Promise<{ ok: boolean; note: string }> {
  if (order.paymentGateway === "WALLET" && order.userId) {
    // One refund credit per wallet debit: the ref ties it to that debit, and a retry finds it.
    const ref = `hotel_refund_${order.paymentOrderId ?? order.id}`;
    if (await walletTxExists(db, ref)) return { ok: true, note: "Refund already credited to the Tripcod wallet." };
    const wallet = await getOrCreateCustomerWallet(db, order.tenantId, order.userId);
    await creditWallet(db, wallet.id, amount, "REFUND_CREDIT", {
      bookingId: order.id, paymentId: ref, note: `Refund for hotel booking ${order.supplierBookingId}`,
    });
    return { ok: true, note: `${order.currency} ${amount.toFixed(2)} returned to the Tripcod wallet.` };
  }
  if (order.paymentGateway === "NOMOD" && order.paymentRef) {
    const apiKey = await resolveNomodApiKey(env, order.tenantId);
    if (!apiKey) return { ok: false, note: "Card refund needs the team: Nomod is not configured." };
    const outcome = await refundNomodCharge(apiKey, order.paymentRef, amount, reason.slice(0, 120));
    await hotelLedger(db, order, outcome.ok ? "REFUND_COMPLETED" : "REFUND_FAILED", {
      status: outcome.ok ? "DONE" : "MANUAL_REQUIRED", amount, gatewayRef: outcome.ok ? outcome.refundId : order.paymentRef, message: outcome.ok ? reason : outcome.error });
    if (outcome.ok) return { ok: true, note: `Card refund ${outcome.refundId} issued via Nomod.` };
    return { ok: false, note: `Card refund needs the team: ${outcome.error}` };
  }
  if (order.paymentGateway === "PHONEPE" && order.paymentOrderId) {
    // Only with the credentials of the environment the order was created in.
    const cfg = resolvePhonePeConfig(env);
    if (!cfg || merchantOrderEnvironment(order.paymentOrderId) !== cfg.environment) {
      await hotelLedger(db, order, "REFUND_FAILED", { status: "MANUAL_REQUIRED", amount, message: "PhonePe credentials for this order's environment are not active" });
      return { ok: false, note: "UPI refund needs the team: PhonePe is not configured for this payment's environment." };
    }
    const merchantRefundId = `RF_${order.paymentOrderId}_0`.slice(0, 63);
    try {
      const r = await refundPhonePe(cfg, env.SESSIONS_KV, { merchantRefundId, merchantOrderId: order.paymentOrderId, amountPaise: toPaise(amount) });
      if (r.state === "FAILED") throw new Error("PhonePe rejected the refund");
      await hotelLedger(db, order, r.state === "COMPLETED" ? "REFUND_COMPLETED" : "REFUND_ACCEPTED", { status: r.state, amount, gatewayRef: merchantRefundId, message: reason });
      return { ok: true, note: `UPI refund ${merchantRefundId} issued via PhonePe (usually 5–7 working days).` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await hotelLedger(db, order, "REFUND_FAILED", { status: "MANUAL_REQUIRED", amount, gatewayRef: merchantRefundId, message });
      return { ok: false, note: `UPI refund needs the team: ${message}` };
    }
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

export type HotelQueueMsg =
  | { type: "HOTEL_PAYMENT_CAPTURED"; hotelBookingId: string; tenantId: string }
  | { type: "HOTEL_HOLD_EXPIRY_CHECK"; hotelBookingId: string; tenantId: string };

export async function hotelOrderDeps(env: Env, db: Db, tenantId: string, opts: { recorder?: ExchangeRecorder; waitUntil?: (p: Promise<unknown>) => void; pollMs?: number } = {}): Promise<HotelOrderDeps> {
  return {
    store:   d1HotelOrderStore(env.HOTEL_DB, tenantId),
    client:  await hotelClient(env, tenantId, opts.recorder),
    call:    supplierCall(db, tenantId, opts.waitUntil),
    refund:  (order, amount, reason) => refundHotelPayment(env, db, order, amount, reason),
    enqueue: async (id) => { await env.BOOKING_QUEUE.send({ type: "HOTEL_PAYMENT_CAPTURED", hotelBookingId: id, tenantId } satisfies HotelQueueMsg); },
    walletDebited: (ref) => walletTxExists(db, ref),
    phonepeStatus: (merchantOrderId) => hotelPhonePeStatus(env, merchantOrderId),
    ledger:  (order, event, fields) => hotelLedger(db, order, event, fields),
    pollMs:  opts.pollMs,
  };
}

// Admin → Transactions: hotel payment events next to flight ones (Neon ledger,
// referenced by the D1 order id).
export async function hotelLedger(db: Db, order: HotelOrder, event: string, f: { status?: string; amount?: number | string; gatewayRef?: string | null; message?: string } = {}) {
  const gateway = (order.paymentGateway ?? "MANUAL") as "NOMOD" | "PHONEPE" | "WALLET" | "MANUAL";
  await logPaymentEvent(db, {
    tenantId: order.tenantId, product: "HOTEL", referenceId: order.id, gateway,
    environment: gateway === "PHONEPE" && order.paymentOrderId ? merchantOrderEnvironment(order.paymentOrderId) : null,
    event, status: f.status ?? null, amount: f.amount ?? null, currency: order.currency, gatewayRef: f.gatewayRef ?? order.paymentOrderId,
    message: f.message ?? `TripJack ${order.supplierBookingId}`,
  });
}

// ── UPI payment (PhonePe PG v2, INR only) ────────────────────────────────────

async function hotelPhonePeStatus(env: Env, merchantOrderId: string) {
  const cfg = resolvePhonePeConfig(env);
  if (!cfg || merchantOrderEnvironment(merchantOrderId) !== cfg.environment) return null;
  const st = await phonePeOrderStatus(cfg, env.SESSIONS_KV, merchantOrderId);
  const paid = st.paymentDetails?.find((d) => d.state === "COMPLETED") ?? st.paymentDetails?.[0];
  return { state: st.state, amountPaise: st.amount, transactionId: paid?.transactionId ?? null };
}

export async function upiPaymentAvailable(env: Env, tenantId: string): Promise<boolean> {
  return gatewayAvailability(env, await tenantPaymentSettings(env, tenantId)).PHONEPE;
}

export async function createHotelPhonePeOrder(env: Env, tenantId: string, order: HotelOrder, returnUrl: string): Promise<{ id: string; url: string }> {
  const cfg = resolvePhonePeConfig(env);
  if (!cfg || !(await upiPaymentAvailable(env, tenantId))) throw Object.assign(new Error("UPI payment is not available right now."), { status: 503 });
  if (order.currency !== "INR") throw Object.assign(new Error("UPI payment is available for INR bookings only."), { status: 400 });
  const merchantOrderId = newMerchantOrderId("TCH", cfg.environment);
  const hotel = order.hotel as { name?: string };
  const created = await createPhonePePayment(cfg, env.SESSIONS_KV, {
    merchantOrderId, amountPaise: toPaise(Number(order.amount)), redirectUrl: returnUrl, expireAfterSeconds: 1200,
    message: `Hotel: ${(hotel.name ?? "stay").slice(0, 60)}`, udf: { udf1: "HOTEL", udf2: order.id },
  }).catch((err) => { throw Object.assign(new Error(`UPI payment could not be started: ${err?.message ?? err}`), { status: 502 }); });
  return { id: merchantOrderId, url: created.redirectUrl! };
}

// PhonePe webhook for a hotel order: re-check with the status API. Returns null
// when no hotel order uses this merchant order id.
export async function handleHotelPhonePeEvent(env: Env, db: Db, merchantOrderId: string) {
  const order = await d1HotelOrderStore(env.HOTEL_DB).byPaymentOrder([merchantOrderId]);
  if (!order || order.paymentGateway !== "PHONEPE") return null;
  const { reconcilePhonePePayment } = await import("./hotel-orders.js");
  const deps = await hotelOrderDeps(env, db, order.tenantId);
  const after = await reconcilePhonePePayment(deps, order);
  return { hotelOrder: order.id, paymentStatus: after.paymentStatus };
}

// PhonePe refund webhook for a hotel order (refund ids are RF_<merchant order id>_0).
export async function handleHotelPhonePeRefund(env: Env, db: Db, merchantRefundId: string, state: string) {
  const merchantOrderId = /^RF_(TCH[UP]_[A-Z0-9_]+?)_\d+$/.exec(merchantRefundId)?.[1];
  if (!merchantOrderId) return null;
  const order = await d1HotelOrderStore(env.HOTEL_DB).byPaymentOrder([merchantOrderId]);
  if (!order) return null;
  if (state === "COMPLETED") await hotelLedger(db, order, "REFUND_COMPLETED", { status: "DONE", amount: order.refundAmount ?? undefined, gatewayRef: merchantRefundId });
  if (state === "FAILED") {
    await hotelLedger(db, order, "REFUND_FAILED", { status: "MANUAL_REQUIRED", amount: order.refundAmount ?? undefined, gatewayRef: merchantRefundId, message: "PhonePe reported the refund failed" });
    await d1HotelOrderStore(env.HOTEL_DB, order.tenantId).update(order.id, { paymentStatus: "REFUND_PENDING", refundNote: "UPI refund failed at PhonePe — the team will retry it." }, { paymentStatus: ["REFUNDED"] });
  }
  return { hotelOrder: order.id };
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

export async function processHotelPayment(env: Env, db: Db, msg: Extract<HotelQueueMsg, { type: "HOTEL_PAYMENT_CAPTURED" }>) {
  const { processPaidOrder } = await import("./hotel-orders.js");
  // Book / confirm-book after payment run here, outside any request: record them
  // too, so instant and confirm-hold UAT logs exist (linked to the TripJack booking).
  const collector = collectExchanges();
  const deps = await hotelOrderDeps(env, db, msg.tenantId, { pollMs: 60_000, recorder: collector.recorder });
  let order: Awaited<ReturnType<typeof processPaidOrder>> = null;
  try {
    order = await processPaidOrder(deps, msg.hotelBookingId);
  } finally {
    await persistHotelExchanges(env, db, msg.tenantId, collector.exchanges, { bookingId: order?.supplierBookingId ?? null, requestId: `hotel-queue-${msg.hotelBookingId}` })
      .catch((err) => console.error("[hotel-order] exchange logs not stored", err));
  }
  console.info(`[hotel-order] ${msg.hotelBookingId} after payment: ${order?.status ?? "missing"} / ${order?.supplierStatus ?? "-"}`);
}

// ── Hold expiry: scheduled sweep → queue → one claimed Booking Details check ──

// Holds that may be due (all tenants). Small set: only unpaid holds still ON_HOLD.
export async function holdExpiryCandidates(d1: D1Database, limit = 200): Promise<HotelOrder[]> {
  const { results } = await d1.prepare(`SELECT * FROM hotel_bookings WHERE mode = 'HOLD' AND status = 'ON_HOLD'
      AND hold_deadline IS NOT NULL AND supplier_submitted_at IS NOT NULL AND payment_status IN ('UNPAID', 'PENDING', 'REFUNDED')
      ORDER BY hold_deadline LIMIT ?`).bind(limit).all<Record<string, unknown>>();
  return results.map(rowToOrder);
}

// Cron: queue one check per hold whose deadline has passed. The consumer claims
// each order before calling TripJack, so overlapping sweeps can't double-process.
export async function sweepExpiredHolds(env: Pick<Env, "HOTEL_DB" | "BOOKING_QUEUE">, now = Date.now()) {
  const { holdCheckDue } = await import("./hotel-orders.js");
  const due = (await holdExpiryCandidates(env.HOTEL_DB)).filter((o) => holdCheckDue(o, now));
  for (let i = 0; i < due.length; i += 100) {
    await env.BOOKING_QUEUE.sendBatch(due.slice(i, i + 100).map((o) => ({
      body: { type: "HOTEL_HOLD_EXPIRY_CHECK", hotelBookingId: o.id, tenantId: o.tenantId } satisfies HotelQueueMsg,
    })));
  }
  return { queued: due.length };
}

// Queue: one hold's expiry check. The Booking Details request / response is
// stored with the booking's UAT logs (Admin → Hotel UAT logs → ZIP).
export async function processHoldExpiry(env: Env, db: Db, msg: Extract<HotelQueueMsg, { type: "HOTEL_HOLD_EXPIRY_CHECK" }>) {
  const { checkExpiredHold } = await import("./hotel-orders.js");
  const collector = collectExchanges();
  const deps = await hotelOrderDeps(env, db, msg.tenantId, { recorder: collector.recorder });
  let result: Awaited<ReturnType<typeof checkExpiredHold>> = { order: null, checked: false };
  try {
    result = await checkExpiredHold(deps, msg.hotelBookingId);
  } finally {
    await persistHotelExchanges(env, db, msg.tenantId, collector.exchanges, {
      bookingId: result.order?.supplierBookingId ?? null, requestId: `hotel-hold-expiry-${msg.hotelBookingId}`,
    }).catch((err) => console.error("[hotel-hold-expiry] exchange logs not stored", err));
  }
  console.info(`[hotel-hold-expiry] ${msg.hotelBookingId}: ${result.checked ? "checked" : "skipped"} → ${result.order?.status ?? "missing"} / ${result.order?.supplierStatus ?? "-"}`);
  return result;
}

// Nomod charge events for hotel orders. Returns null when no hotel order uses these ids.
export async function handleHotelNomodEvent(env: Env, db: Db, type: string, chargeId: string | undefined, candidates: string[], paid: { amount?: number; currency?: string } = {}) {
  const order = await d1HotelOrderStore(env.HOTEL_DB).byPaymentOrder(candidates);
  if (!order || order.paymentGateway !== "NOMOD") return null;
  const { recordPaid } = await import("./hotel-orders.js");
  const store = d1HotelOrderStore(env.HOTEL_DB, order.tenantId);
  if (type === "charge.completed") {
    if (order.paymentStatus !== "PENDING") return { hotelOrder: order.id, duplicate: true };
    // Never book on an under-payment or another currency (over-payment = tips/fees is fine).
    const short = paid.amount !== undefined && Number.isFinite(paid.amount) && paid.amount < Number(order.amount) - 0.009;
    const otherCurrency = paid.currency !== undefined && paid.currency.toUpperCase() !== order.currency;
    if (short || otherCurrency) {
      await hotelLedger(db, order, "AMOUNT_MISMATCH", { status: "MANUAL_REVIEW", amount: paid.amount, gatewayRef: chargeId,
        message: `Expected ${order.currency} ${Number(order.amount).toFixed(2)}, Nomod reported ${paid.currency ?? order.currency} ${paid.amount ?? "?"} — not booked` });
      await store.update(order.id, { lastError: "Nomod amount mismatch — check Admin → Transactions" }, { paymentStatus: ["PENDING"] });
      return { hotelOrder: order.id, amountMismatch: true };
    }
    await recordPaid({
      store,
      ledger: (o, event, fields) => hotelLedger(db, o, event, fields),
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
