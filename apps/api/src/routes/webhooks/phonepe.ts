import type { Handler } from "hono";
import { payments } from "@tripcod/db/schema";
import { and, eq } from "drizzle-orm";
import type { Env, Variables } from "../../types.js";
import { logPaymentEvent, settlePhonePeRefund } from "../../lib/payment-core.js";
import { reconcilePhonePe } from "../../lib/checkout-gateways.js";
import { phonePeRefundStatus, resolvePhonePeConfig, verifyPhonePeWebhook } from "../../lib/phonepe.js";
import { handleHotelPhonePeEvent, handleHotelPhonePeRefund } from "../../lib/hotel-order-store.js";

// PhonePe PG v2 webhook. Authorization: SHA256(username:password) of the webhook
// user set on the PhonePe dashboard for this Worker's environment. The payload
// is never trusted for money: it only tells us which order / refund to re-check
// with PhonePe's status APIs.
// Events: checkout.order.completed | checkout.order.failed |
//         pg.refund.accepted | pg.refund.completed | pg.refund.failed
export const phonepeWebhook: Handler<{ Bindings: Env; Variables: Variables }> = async (c) => {
  const cfg = resolvePhonePeConfig(c.env);
  if (!cfg || !cfg.webhookUsername || !cfg.webhookPassword) {
    console.error("[phonepe-webhook] PhonePe credentials / webhook user are not configured");
    return c.json({ error: "Webhook not configured" }, 500);
  }
  if (!(await verifyPhonePeWebhook(cfg, c.req.header("Authorization")))) {
    console.warn("[phonepe-webhook] rejected: bad Authorization");
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, any>;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const event = String(body.event ?? body.type ?? "").toLowerCase().replace(/_/g, ".");
  const payload = (body.payload ?? body.data ?? {}) as Record<string, any>;
  const db = c.get("db");

  if (event.includes("refund")) {
    const merchantRefundId = String(payload.merchantRefundId ?? "");
    if (!merchantRefundId) return c.json({ ok: true, matched: false });
    const status = await phonePeRefundStatus(cfg, c.env.SESSIONS_KV, merchantRefundId).catch(() => null);
    const state = status?.state ?? "PENDING";
    // Hotel orders (D1) use RF_TCH… ids; flight payments are in Neon.
    if (merchantRefundId.startsWith("RF_TCH")) return c.json({ ok: true, ...(await handleHotelPhonePeRefund(c.env, db, merchantRefundId, state)) });
    await settlePhonePeRefund(db, merchantRefundId, state, { event, state: payload.state, verifiedState: status?.state });
    return c.json({ ok: true });
  }

  const merchantOrderId = String(payload.merchantOrderId ?? "");
  const [payment] = merchantOrderId
    ? await db.select().from(payments).where(and(eq(payments.gateway, "PHONEPE"), eq(payments.gatewayOrderId, merchantOrderId))).limit(1)
    : [];
  if (!payment) {
    // Website hotel order (D1): same status-API check.
    const hotel = merchantOrderId ? await handleHotelPhonePeEvent(c.env, db, merchantOrderId) : null;
    if (hotel) return c.json({ ok: true, ...hotel });
    console.warn(`[phonepe-webhook] ${event} ${merchantOrderId}: no matching PHONEPE payment`);
    return c.json({ ok: true, matched: false });
  }
  await logPaymentEvent(db, {
    paymentId: payment.id, product: "FLIGHT", referenceId: payment.bookingId,
    gateway: "PHONEPE", environment: payment.environment, event: "WEBHOOK", status: String(payload.state ?? event), gatewayRef: merchantOrderId,
    message: event, raw: { event, state: payload.state, amount: payload.amount, orderId: payload.orderId },
  });
  // Server-to-server status check decides; a throw makes PhonePe retry the webhook.
  const outcome = await reconcilePhonePe(db, c.env, payment, "PHONEPE_WEBHOOK");
  return c.json({ ok: true, outcome });
};
