// Gateway-agnostic flight payment handling shared by Nomod and PhonePe (hotel
// orders keep their own D1 payment slot in hotel-orders.ts and only use the
// ledger and PhonePe refund from here):
//   capturePayment  — a gateway says an order was paid: check amount/currency,
//                     claim the payments row once, detect duplicate charges and
//                     only then hand the booking to the supplier queue.
//   refundPayment   — refund a captured charge once (full or partial) through
//                     the gateway it was taken on.
//   logPaymentEvent — append-only ledger behind Admin → Transactions.

import type { Db } from "@tripcod/db";
import { bookings, paymentEvents, payments } from "@tripcod/db/schema";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Env } from "../types.js";
import { refundNomodCharge, resolveNomodApiKey } from "./payment-gateway.js";
import { refundPhonePe, resolvePhonePeConfig, toPaise, PhonePeError } from "./phonepe.js";

export type PaymentRow = typeof payments.$inferSelect;
type Gateway = PaymentRow["gateway"];

export interface PaymentEvent {
  tenantId?:    string | null;
  paymentId?:   string | null;
  product:      "FLIGHT" | "HOTEL";
  referenceId?: string | null;
  gateway:      Gateway;
  environment?: string | null;
  event:        string;
  status?:      string | null;
  amount?:      number | string | null;
  currency?:    string | null;
  gatewayRef?:  string | null;
  message?:     string | null;
  raw?:         unknown;
}

// Never throws: a ledger write must not break a payment or webhook.
export async function logPaymentEvent(db: Db, e: PaymentEvent): Promise<void> {
  try {
    await db.insert(paymentEvents).values({
      tenantId: e.tenantId ?? null, paymentId: e.paymentId ?? null, product: e.product, referenceId: e.referenceId ?? null,
      gateway: e.gateway, environment: e.environment ?? null, event: e.event, status: e.status ?? null,
      amount: e.amount == null ? null : Number(e.amount).toFixed(2), currency: e.currency ?? null,
      gatewayRef: e.gatewayRef ?? null, message: e.message?.slice(0, 500) ?? null, raw: e.raw === undefined ? null : redact(e.raw),
    });
  } catch (err) {
    console.error(`[payment-ledger] ${e.event} for payment ${e.paymentId ?? "?"} not recorded:`, err);
  }
}

// Keep card / VPA / token-like fields out of the ledger.
const SENSITIVE = /(card|cvv|pan$|vpa|upi.?id|token|secret|password|authorization|account.?number|ifsc)/i;
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) ? "[redacted]" : redact(x, depth + 1)]));
  }
  return typeof v === "string" && v.length > 500 ? `${v.slice(0, 500)}…` : v;
}

const productOf = (_p: PaymentRow) => "FLIGHT" as const;
const referenceOf = (p: Pick<PaymentRow, "bookingId">) => p.bookingId;

export async function tenantOf(db: Db, p: Pick<PaymentRow, "bookingId">): Promise<string | null> {
  const [b] = await db.select({ tenantId: bookings.tenantId }).from(bookings).where(eq(bookings.id, p.bookingId)).limit(1);
  return b?.tenantId ?? null;
}

// ── Capture ─────────────────────────────────────────────────────────────────

export type CaptureOutcome =
  | "CAPTURED"           // booking handed to the supplier queue
  | "ALREADY_CAPTURED"   // repeated webhook / status check: nothing done
  | "AMOUNT_MISMATCH"    // paid amount differs: not booked, Admin must act
  | "DUPLICATE_CHARGE"   // booking was already paid: this charge is refunded
  | "LATE_PAYMENT";      // booking no longer payable: this charge is refunded

export interface CaptureInput {
  paymentId:        string;
  gatewayPaymentId: string;
  paidAmount?:      number;   // major units, as reported by the gateway (omit when the gateway doesn't send it)
  paidCurrency?:    string;
  exactAmount?:     boolean;  // true: any difference blocks; false: only under-payment blocks
  source:           string;   // WEBHOOK | STATUS_CHECK | RETURN_URL ...
  raw?:             unknown;
}

export interface CaptureDeps {
  enqueueFlight: (msg: { type: "PAYMENT_CAPTURED"; gatewayPaymentId: string; orderId: string; amount: number }) => Promise<void>;
  refund?:       (payment: PaymentRow, reason: string) => Promise<RefundOutcome>;
}

const isUniqueViolation = (err: unknown) => /23505|duplicate key|unique constraint/i.test(String((err as any)?.code ?? "") + String((err as any)?.message ?? ""));

export async function capturePayment(db: Db, env: Env, input: CaptureInput, deps: CaptureDeps): Promise<CaptureOutcome> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
  if (!payment) throw new Error(`Payment ${input.paymentId} not found`);
  const tenantId = await tenantOf(db, payment);
  const base = {
    tenantId, paymentId: payment.id, product: productOf(payment), referenceId: referenceOf(payment),
    gateway: payment.gateway, environment: payment.environment, gatewayRef: input.gatewayPaymentId,
  } as const;
  const refund = deps.refund ?? ((p: PaymentRow, reason: string) => refundPayment(db, env, p, { reason }));

  if (payment.status === "SUCCESS" || payment.status === "REFUNDED" || payment.status === "PARTIAL_REFUND") {
    await logPaymentEvent(db, { ...base, event: "DUPLICATE_EVENT", status: payment.status, message: `${input.source}: already ${payment.status}` });
    return "ALREADY_CAPTURED";
  }

  // Never book on a short or foreign-currency payment.
  const expected = Number(payment.amount);
  const amountOff = input.paidAmount !== undefined && Number.isFinite(input.paidAmount)
    && (input.exactAmount ? Math.abs(input.paidAmount - expected) > 0.009 : input.paidAmount < expected - 0.009);
  const currencyOff = input.paidCurrency !== undefined && input.paidCurrency.toUpperCase() !== payment.currency;
  if (amountOff || currencyOff) {
    await db.update(payments).set({ gatewayPaymentId: input.gatewayPaymentId, gatewayResponse: mergeResponse(payment, { amountMismatch: { paidAmount: input.paidAmount, paidCurrency: input.paidCurrency } }), updatedAt: new Date() })
      .where(eq(payments.id, payment.id)).catch(() => {});
    await logPaymentEvent(db, { ...base, event: "AMOUNT_MISMATCH", status: "MANUAL_REVIEW", amount: input.paidAmount, currency: input.paidCurrency,
      message: `Expected ${payment.currency} ${expected.toFixed(2)}, gateway reported ${input.paidCurrency ?? payment.currency} ${input.paidAmount?.toFixed(2) ?? "?"} — not booked`, raw: input.raw });
    return "AMOUNT_MISMATCH";
  }

  // Claim the row once: concurrent webhooks / status checks race here.
  let claimed: PaymentRow | undefined;
  try {
    [claimed] = await db.update(payments)
      .set({ status: "SUCCESS", gatewayPaymentId: input.gatewayPaymentId, updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), inArray(payments.status, ["PENDING", "FAILED"])))
      .returning();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Another payment for this booking is already SUCCESS (one-capture index).
    const dup = { ...payment, gatewayPaymentId: input.gatewayPaymentId };
    await db.update(payments).set({ gatewayPaymentId: input.gatewayPaymentId, updatedAt: new Date() }).where(eq(payments.id, payment.id)).catch(() => {});
    await logPaymentEvent(db, { ...base, event: "DUPLICATE_CHARGE", status: "REFUNDING", amount: payment.amount, currency: payment.currency,
      message: "Booking already paid by another charge — refunding this one", raw: input.raw });
    await refund(dup, "Duplicate payment for an already-paid booking");
    return "DUPLICATE_CHARGE";
  }
  if (!claimed) {
    await logPaymentEvent(db, { ...base, event: "DUPLICATE_EVENT", message: `${input.source}: payment no longer pending` });
    return "ALREADY_CAPTURED";
  }

  await logPaymentEvent(db, { ...base, event: "CAPTURED", status: "SUCCESS", amount: claimed.amount, currency: claimed.currency,
    message: `Payment confirmed via ${input.source}`, raw: input.raw });

  // A different captured payment for the same booking (e.g. paid by wallet
  // while a card link was open, or no unique index yet): refund this one.
  const sibling = await db.select({ id: payments.id }).from(payments).where(and(
    eq(payments.bookingId, claimed.bookingId),
    ne(payments.id, claimed.id), eq(payments.status, "SUCCESS"),
  )).limit(1);
  if (sibling.length) {
    await logPaymentEvent(db, { ...base, event: "DUPLICATE_CHARGE", status: "REFUNDING", amount: claimed.amount, currency: claimed.currency,
      message: `Booking already paid (payment ${sibling[0].id}) — refunding this charge` });
    await refund(claimed, "Duplicate payment for an already-paid booking");
    return "DUPLICATE_CHARGE";
  }

  const [booking] = await db.update(bookings)
    .set({ status: "PAYMENT_PENDING", updatedAt: new Date() })
    .where(and(eq(bookings.id, claimed.bookingId), inArray(bookings.status, ["HELD", "PAYMENT_PENDING"])))
    .returning({ id: bookings.id });
  if (!booking) {
    await logPaymentEvent(db, { ...base, event: "LATE_PAYMENT", status: "REFUNDING", message: "Booking is no longer awaiting payment — refunding" });
    await refund(claimed, "Booking was no longer payable when the payment completed");
    return "LATE_PAYMENT";
  }
  try {
    await deps.enqueueFlight({ type: "PAYMENT_CAPTURED", gatewayPaymentId: input.gatewayPaymentId, orderId: claimed.gatewayOrderId!, amount: Number(claimed.amount) });
  } catch (err) {
    await unclaim(db, claimed.id);
    throw err;
  }
  return "CAPTURED";
}

async function unclaim(db: Db, paymentId: string) {
  await db.update(payments).set({ status: "PENDING", updatedAt: new Date() }).where(eq(payments.id, paymentId));
  await db.delete(paymentEvents).where(and(eq(paymentEvents.paymentId, paymentId), eq(paymentEvents.event, "CAPTURED")));
}

// Gateway reports the order failed / cancelled / expired.
export async function markPaymentFailed(db: Db, paymentId: string, source: string, raw?: unknown): Promise<boolean> {
  const [row] = await db.update(payments).set({ status: "FAILED", updatedAt: new Date() })
    .where(and(eq(payments.id, paymentId), eq(payments.status, "PENDING"))).returning();
  if (row) {
    await logPaymentEvent(db, { tenantId: await tenantOf(db, row), paymentId: row.id, product: productOf(row), referenceId: referenceOf(row),
      gateway: row.gateway, environment: row.environment, event: "FAILED", status: "FAILED", amount: row.amount, currency: row.currency, message: `Payment failed (${source})`, raw });
  }
  return Boolean(row);
}

function mergeResponse(p: PaymentRow, extra: Record<string, unknown>) {
  return { ...((p.gatewayResponse as Record<string, unknown> | null) ?? {}), ...extra };
}

// ── Refunds ─────────────────────────────────────────────────────────────────

export type RefundOutcome =
  | { ok: true; refundRef: string; pending: boolean }             // gateway accepted (PhonePe settles asynchronously)
  | { ok: false; definite: boolean; error: string; skipped?: boolean };

const round2 = (n: number) => Math.round(n * 100) / 100;

// Refunds `amount` (default: everything not yet refunded) of a captured charge,
// in the currency it was charged in. Idempotent per payment: a refund in flight
// (refundInitiatedAt set, not completed) is never sent twice; a definite gateway
// rejection releases the claim so it can be retried.
export async function refundPayment(
  db: Db, env: Env, payment: PaymentRow,
  opts: { amount?: number; reason: string; actor?: string },
): Promise<RefundOutcome> {
  if (payment.gateway !== "NOMOD" && payment.gateway !== "PHONEPE") {
    return { ok: false, definite: true, skipped: true, error: `${payment.gateway} payments are refunded by their own flow` };
  }
  const charged = Number(payment.amount);
  const already = Number(payment.refundedAmount ?? 0);
  const amount = round2(Math.min(opts.amount ?? charged - already, charged - already));
  const tenantId = await tenantOf(db, payment);
  const base = { tenantId, paymentId: payment.id, product: productOf(payment), referenceId: referenceOf(payment), gateway: payment.gateway, environment: payment.environment } as const;
  if (amount <= 0) return { ok: false, definite: true, skipped: true, error: "Nothing left to refund" };
  if (!payment.gatewayPaymentId && payment.gateway === "NOMOD") return { ok: false, definite: true, error: "No Nomod charge id on this payment" };

  // Claim: only one refund request per payment can be in flight.
  const [claim] = await db.update(payments)
    .set({ refundInitiatedAt: new Date(), refundCompletedAt: null, updatedAt: new Date() })
    .where(and(eq(payments.id, payment.id), sql`(${payments.refundInitiatedAt} IS NULL OR ${payments.refundCompletedAt} IS NOT NULL)`,
      sql`COALESCE(${payments.refundedAmount}, 0) = ${already.toFixed(2)}`))
    .returning({ id: payments.id });
  if (!claim) {
    await logPaymentEvent(db, { ...base, event: "REFUND_SKIPPED", message: "A refund for this payment is already in progress" });
    return { ok: false, definite: true, skipped: true, error: "A refund for this payment is already in progress" };
  }
  await logPaymentEvent(db, { ...base, event: "REFUND_REQUESTED", status: "PENDING", amount, currency: payment.currency, message: `${opts.reason}${opts.actor ? ` (by ${opts.actor})` : ""}` });

  const release = () => db.update(payments)
    .set({ refundInitiatedAt: null, refundCompletedAt: payment.refundCompletedAt, updatedAt: new Date() }).where(eq(payments.id, payment.id));
  const settle = async (refundRef: string, pending: boolean) => {
    const total = round2(already + amount);
    await db.update(payments).set({
      refundedAmount: total.toFixed(2), refundGatewayRef: refundRef,
      ...(pending ? {} : { refundCompletedAt: new Date() }),
      status: total >= charged - 0.009 ? "REFUNDED" : "PARTIAL_REFUND", updatedAt: new Date(),
    }).where(eq(payments.id, payment.id));
    await logPaymentEvent(db, { ...base, event: pending ? "REFUND_ACCEPTED" : "REFUND_COMPLETED", status: pending ? "PENDING" : "DONE", amount, currency: payment.currency, gatewayRef: refundRef });
    return { ok: true as const, refundRef, pending };
  };

  if (payment.gateway === "NOMOD") {
    const apiKey = tenantId ? await resolveNomodApiKey(env, tenantId) : env.NOMOD_API_KEY;
    if (!apiKey) {
      await release();
      await logPaymentEvent(db, { ...base, event: "REFUND_FAILED", status: "MANUAL_REQUIRED", amount, message: "Nomod API key not configured — refund from the Nomod dashboard" });
      return { ok: false, definite: true, error: "Nomod API key not configured" };
    }
    const out = await refundNomodCharge(apiKey, payment.gatewayPaymentId!, amount, opts.reason);
    if (out.ok) return settle(`nomod:${out.refundId}`, false);
    if (out.definite) await release();
    await logPaymentEvent(db, { ...base, event: "REFUND_FAILED", status: out.definite ? "FAILED" : "UNKNOWN", amount,
      message: out.definite ? `Nomod HTTP ${out.httpStatus}: ${out.error}` : `No response from Nomod (${out.error}) — check the Nomod dashboard before retrying` });
    return { ok: false, definite: out.definite, error: out.error };
  }

  // PhonePe: only with the credentials of the environment the charge was taken in.
  const cfg = resolvePhonePeConfig(env);
  if (!cfg || (payment.environment && cfg.environment !== payment.environment)) {
    await release();
    const error = !cfg ? "PhonePe credentials not configured" : `Charge was taken in PhonePe ${payment.environment}; this Worker uses ${cfg.environment}`;
    await logPaymentEvent(db, { ...base, event: "REFUND_FAILED", status: "MANUAL_REQUIRED", amount, message: error });
    return { ok: false, definite: true, error };
  }
  // Deterministic id: a retried request is de-duplicated by PhonePe itself.
  const merchantRefundId = `RF_${payment.gatewayOrderId}_${Math.round(already * 100)}`.slice(0, 63);
  try {
    const r = await refundPhonePe(cfg, env.SESSIONS_KV, { merchantRefundId, merchantOrderId: payment.gatewayOrderId!, amountPaise: toPaise(amount) });
    if (r.state === "FAILED") {
      await release();
      await logPaymentEvent(db, { ...base, event: "REFUND_FAILED", status: "FAILED", amount, gatewayRef: merchantRefundId, message: "PhonePe rejected the refund" });
      return { ok: false, definite: true, error: "PhonePe rejected the refund" };
    }
    return settle(`phonepe:${merchantRefundId}`, r.state !== "COMPLETED");
  } catch (err) {
    const definite = err instanceof PhonePeError && err.definite;
    if (definite) await release();
    const error = err instanceof Error ? err.message : String(err);
    await logPaymentEvent(db, { ...base, event: "REFUND_FAILED", status: definite ? "FAILED" : "UNKNOWN", amount, gatewayRef: merchantRefundId, message: error });
    return { ok: false, definite, error };
  }
}

// PhonePe refund webhook / status: record the final state of an accepted refund.
export async function settlePhonePeRefund(db: Db, merchantRefundId: string, state: string, raw?: unknown): Promise<void> {
  const [p] = await db.select().from(payments).where(and(eq(payments.gateway, "PHONEPE"), eq(payments.refundGatewayRef, `phonepe:${merchantRefundId}`))).limit(1);
  if (!p) return;
  const tenantId = await tenantOf(db, p);
  const base = { tenantId, paymentId: p.id, product: productOf(p), referenceId: referenceOf(p), gateway: p.gateway, environment: p.environment, gatewayRef: merchantRefundId } as const;
  if (state === "COMPLETED") {
    const [done] = await db.update(payments).set({ refundCompletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payments.id, p.id), isNull(payments.refundCompletedAt))).returning({ id: payments.id });
    if (done) await logPaymentEvent(db, { ...base, event: "REFUND_COMPLETED", status: "DONE", amount: p.refundedAmount, currency: p.currency, raw });
  } else if (state === "FAILED") {
    await logPaymentEvent(db, { ...base, event: "REFUND_FAILED", status: "MANUAL_REQUIRED", amount: p.refundedAmount, currency: p.currency, message: "PhonePe reported the refund failed — retry from Admin → Transactions", raw });
    // Roll back to what was refunded before this request (encoded in the id) so Admin can retry.
    const before = Number(merchantRefundId.split("_").pop()) / 100 || 0;
    await db.update(payments).set({
      status: before > 0 ? "PARTIAL_REFUND" : "SUCCESS", refundedAmount: before > 0 ? before.toFixed(2) : null,
      refundInitiatedAt: null, refundCompletedAt: before > 0 ? new Date() : null, refundGatewayRef: null, updatedAt: new Date(),
    }).where(eq(payments.id, p.id)).catch((err) => console.error(`[phonepe-refund] rollback for ${p.id} failed:`, err));
  }
}
