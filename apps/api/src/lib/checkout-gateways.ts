// Starts a hosted checkout (Nomod payment link or PhonePe PG v2 order) for a
// flight booking and reconciles PhonePe orders against the status API. The
// amount always comes from the server-side booking row. (Hotel orders use the
// same gateways through hotel-order-store.ts.)

import type { Db } from "@tripcod/db";
import { payments } from "@tripcod/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../types.js";
import { capturePayment, logPaymentEvent, markPaymentFailed, type CaptureOutcome, type PaymentRow } from "./payment-core.js";
import { captureDeps } from "./payment-queue.js";
import {
  createPhonePePayment, missingPhonePeSecrets, newMerchantOrderId, phonePeOrderStatus, resolvePhonePeConfig, toPaise, PhonePeError,
} from "./phonepe.js";

export type Gateway = "NOMOD" | "PHONEPE";
export type CheckoutTarget = { kind: "FLIGHT"; bookingId: string };

export const webUrl = (env: Env) => (env.PUBLIC_WEB_URL || "https://tripcod.com").replace(/\/+$/, "");

export async function tenantPaymentSettings(env: Env, tenantId: string): Promise<Record<string, any> | null> {
  const raw = await env.TENANT_CACHE_KV.get(`admin_settings:${tenantId}:payments`);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// PhonePe is offered only when Admin enabled it AND the active environment's
// credentials, including the webhook user, are all present.
export function gatewayAvailability(env: Env, settings: Record<string, any> | null) {
  const nomod = Boolean(settings?.nomod?.enabled && (settings.nomod.apiKey || env.NOMOD_API_KEY));
  const phonepeReady = missingPhonePeSecrets(env).length === 0 && resolvePhonePeConfig(env) !== null;
  const phonepe = Boolean(settings?.phonepe?.enabled) && phonepeReady;
  return { NOMOD: nomod, PHONEPE: phonepe, phonepeEnvironment: resolvePhonePeConfig(env)?.environment ?? null };
}

const PENDING_REUSE_MS = 15 * 60_000;
const targetWhere = (t: CheckoutTarget) => eq(payments.bookingId, t.bookingId);

export interface CheckoutResult {
  paymentUrl: string;
  orderId:    string;
  amount:     number;
  currency:   string;
  gateway:    Gateway;
  reused:     boolean;
}

export async function createGatewayCheckout(
  db: Db, env: Env,
  p: {
    tenantId: string; settings: Record<string, any> | null; target: CheckoutTarget; gateway: Gateway;
    amount: number; currency: "INR" | "AED" | "USD"; returnUrl: string; title: string; fx?: Record<string, unknown>;
  },
): Promise<CheckoutResult> {
  const product = p.target.kind;
  const referenceId = p.target.bookingId;

  // Duplicate-charge guard 1: never open a checkout for something already paid.
  const existing = await db.select().from(payments).where(targetWhere(p.target)).orderBy(desc(payments.createdAt)).limit(20);
  if (existing.some((x) => ["SUCCESS", "PARTIAL_REFUND"].includes(x.status) && x.gateway !== "MANUAL")) {
    throw new HTTPException(409, { message: "This booking is already paid." });
  }
  // Guard 2: a double click / second tab gets the same open checkout back.
  const open = existing.find((x) => x.status === "PENDING" && x.gateway === p.gateway
    && Number(x.amount) === Number(p.amount.toFixed(2)) && x.currency === p.currency
    && Date.now() - x.createdAt.getTime() < PENDING_REUSE_MS
    && typeof (x.gatewayResponse as any)?.linkUrl === "string");
  if (open) {
    return { paymentUrl: (open.gatewayResponse as any).linkUrl, orderId: open.gatewayOrderId!, amount: Number(open.amount), currency: open.currency, gateway: p.gateway, reused: true };
  }

  if (p.gateway === "NOMOD") {
    const apiKey = p.settings?.nomod?.apiKey || env.NOMOD_API_KEY;
    if (!p.settings?.nomod?.enabled || !apiKey) throw new HTTPException(503, { message: "Nomod is not enabled or its API key is missing" });
    const amount = p.amount.toFixed(2);
    const sep = p.returnUrl.includes("?") ? "&" : "?";
    const linkRes = await fetch("https://api.nomod.com/v1/links", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({
        currency: p.currency,
        items: [{ name: `${p.title} ${referenceId.slice(0, 8)}`, amount, quantity: 1 }],
        title: p.title,
        note: `Payment for ${product === "FLIGHT" ? "booking" : "hotel order"} ${referenceId}`,
        shipping_address_required: false,
        allow_tip: false,
        allow_tabby: p.settings.nomod.allowTabby ?? true,
        allow_tamara: p.settings.nomod.allowTamara ?? true,
        allow_service_fee: false,
        payment_expiry_limit: 1,
        success_url: `${p.returnUrl}${sep}result=success`,
        failure_url: `${p.returnUrl}${sep}result=failed`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await linkRes.text();
    let link: { id?: string; url?: string; amount?: string; currency?: string; error?: { message?: string } } = {};
    try { link = raw ? JSON.parse(raw) : {}; } catch {}
    if (!linkRes.ok || !link.id || !link.url) {
      const message = link.error?.message || raw.slice(0, 240) || `HTTP ${linkRes.status}`;
      await logPaymentEvent(db, { tenantId: p.tenantId, product, referenceId, gateway: "NOMOD", event: "CHECKOUT_FAILED", amount: p.amount, currency: p.currency, message });
      throw new HTTPException(502, { message: `Nomod link failed: ${message}` });
    }
    const [row] = await db.insert(payments).values({
      bookingId: referenceId,
      gateway: "NOMOD", gatewayOrderId: link.id, amount, currency: p.currency, status: "PENDING",
      gatewayResponse: { linkId: link.id, linkUrl: link.url, ...(p.fx ? { fx: p.fx } : {}) },
    }).returning({ id: payments.id });
    await logPaymentEvent(db, { tenantId: p.tenantId, paymentId: row.id, product, referenceId, gateway: "NOMOD", event: "CHECKOUT_CREATED", status: "PENDING", amount: p.amount, currency: p.currency, gatewayRef: link.id });
    return { paymentUrl: link.url, orderId: link.id, amount: Number(link.amount ?? amount), currency: link.currency ?? p.currency, gateway: "NOMOD", reused: false };
  }

  // PhonePe: INR only, amounts in paise.
  const cfg = resolvePhonePeConfig(env);
  if (!gatewayAvailability(env, p.settings).PHONEPE || !cfg) throw new HTTPException(503, { message: "PhonePe is not enabled" });
  if (p.currency !== "INR") throw new HTTPException(400, { message: "PhonePe accepts INR payments only" });
  const merchantOrderId = newMerchantOrderId("TCF", cfg.environment);
  // Row first: a webhook for this order can never arrive before we know it.
  const [row] = await db.insert(payments).values({
    bookingId: referenceId,
    gateway: "PHONEPE", environment: cfg.environment, gatewayOrderId: merchantOrderId, amount: p.amount.toFixed(2), currency: "INR", status: "PENDING",
  }).returning({ id: payments.id });
  try {
    const order = await createPhonePePayment(cfg, env.SESSIONS_KV, {
      merchantOrderId, amountPaise: toPaise(p.amount), redirectUrl: p.returnUrl, message: p.title,
      expireAfterSeconds: 1200, udf: { udf1: product, udf2: referenceId.slice(0, 64) },
    });
    await db.update(payments).set({ gatewayResponse: { phonepeOrderId: order.orderId, linkUrl: order.redirectUrl, expireAt: order.expireAt } }).where(eq(payments.id, row.id));
    await logPaymentEvent(db, { tenantId: p.tenantId, paymentId: row.id, product, referenceId, gateway: "PHONEPE", environment: cfg.environment,
      event: "CHECKOUT_CREATED", status: "PENDING", amount: p.amount, currency: "INR", gatewayRef: merchantOrderId });
    return { paymentUrl: order.redirectUrl!, orderId: merchantOrderId, amount: p.amount, currency: "INR", gateway: "PHONEPE", reused: false };
  } catch (err) {
    await db.update(payments).set({ status: "FAILED", updatedAt: new Date() }).where(eq(payments.id, row.id));
    const message = err instanceof Error ? err.message : String(err);
    await logPaymentEvent(db, { tenantId: p.tenantId, paymentId: row.id, product, referenceId, gateway: "PHONEPE", environment: cfg.environment, event: "CHECKOUT_FAILED", message });
    throw new HTTPException(502, { message: `PhonePe checkout failed: ${err instanceof PhonePeError ? err.message : "please try again"}` });
  }
}

// Ask PhonePe for the order's real state and act on it. Used by the webhook
// (which only tells us *something* happened), the return page and Admin.
export async function reconcilePhonePe(db: Db, env: Env, payment: PaymentRow, source: string, opts: { throttle?: boolean } = {}): Promise<CaptureOutcome | "FAILED" | "PENDING" | "SKIPPED"> {
  if (payment.gateway !== "PHONEPE" || payment.status !== "PENDING" || !payment.gatewayOrderId) return "SKIPPED";
  const cfg = resolvePhonePeConfig(env);
  if (!cfg || (payment.environment && payment.environment !== cfg.environment)) return "SKIPPED";
  if (opts.throttle) {
    const key = `phonepe_check:${payment.id}`;
    const last = Number(await env.SESSIONS_KV.get(key).catch(() => null) ?? 0);
    if (Date.now() - last < 8_000) return "PENDING";
    await env.SESSIONS_KV.put(key, String(Date.now()), { expirationTtl: 60 }).catch(() => {});
  }
  const status = await phonePeOrderStatus(cfg, env.SESSIONS_KV, payment.gatewayOrderId);
  if (status.state === "COMPLETED") {
    const paid = status.paymentDetails?.find((d) => d.state === "COMPLETED") ?? status.paymentDetails?.[0];
    return capturePayment(db, env, {
      paymentId: payment.id,
      gatewayPaymentId: paid?.transactionId || status.orderId || payment.gatewayOrderId,
      paidAmount: status.amount / 100, paidCurrency: "INR", exactAmount: true,
      source, raw: { state: status.state, amount: status.amount, orderId: status.orderId, paymentMode: paid?.paymentMode },
    }, captureDeps(env));
  }
  if (status.state === "FAILED") {
    await markPaymentFailed(db, payment.id, `${source}: PhonePe ${status.errorCode ?? "FAILED"}`, { state: status.state, errorCode: status.errorCode });
    return "FAILED";
  }
  return "PENDING";
}

// Latest payment for a booking / hotel order, captured ones first.
export async function latestPayment(db: Db, target: CheckoutTarget): Promise<PaymentRow | undefined> {
  const rows = await db.select().from(payments).where(targetWhere(target)).orderBy(desc(payments.createdAt)).limit(20);
  return rows.find((r) => ["SUCCESS", "REFUNDED", "PARTIAL_REFUND"].includes(r.status)) ?? rows[0];
}

export async function pendingPhonePe(db: Db, target: CheckoutTarget): Promise<PaymentRow[]> {
  return db.select().from(payments).where(and(targetWhere(target), eq(payments.gateway, "PHONEPE"), inArray(payments.status, ["PENDING"])))
    .orderBy(desc(payments.createdAt)).limit(3);
}
