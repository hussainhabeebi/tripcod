import test from "node:test";
import assert from "node:assert/strict";
import {
  createPhonePePayment, merchantOrderEnvironment, missingPhonePeSecrets, newMerchantOrderId, phonePeEnvironment, phonePeOrderStatus, phonePeToken,
  refundPhonePe, resolvePhonePeConfig, verifyPhonePeWebhook, PhonePeError, type PhonePeConfig,
} from "../src/lib/phonepe.js";
import { redact } from "../src/lib/payment-core.js";

const uat = { PHONEPE_UAT_CLIENT_ID: "u_id", PHONEPE_UAT_CLIENT_SECRET: "u_sec", PHONEPE_UAT_CLIENT_VERSION: "1", PHONEPE_UAT_WEBHOOK_USERNAME: "u", PHONEPE_UAT_WEBHOOK_PASSWORD: "p" };
const prod = { PHONEPE_PROD_CLIENT_ID: "p_id", PHONEPE_PROD_CLIENT_SECRET: "p_sec", PHONEPE_PROD_CLIENT_VERSION: "2", PHONEPE_PROD_WEBHOOK_USERNAME: "pu", PHONEPE_PROD_WEBHOOK_PASSWORD: "pp" };

test("UAT and Production credentials never mix", () => {
  // Production only on the production Worker with PHONEPE_ENV=PRODUCTION.
  assert.equal(phonePeEnvironment({ ENVIRONMENT: "production", PHONEPE_ENV: "PRODUCTION" }), "PRODUCTION");
  assert.equal(phonePeEnvironment({ ENVIRONMENT: "staging", PHONEPE_ENV: "PRODUCTION" }), "UAT");
  assert.equal(phonePeEnvironment({ ENVIRONMENT: "production" }), "UAT");

  assert.equal(resolvePhonePeConfig({ ENVIRONMENT: "production", ...uat, ...prod })?.clientId, "u_id");
  assert.equal(resolvePhonePeConfig({ ENVIRONMENT: "production", PHONEPE_ENV: "PRODUCTION", ...uat, ...prod })?.clientId, "p_id");
  // Production selected but only UAT secrets present → no config (no fallback to UAT).
  assert.equal(resolvePhonePeConfig({ ENVIRONMENT: "production", PHONEPE_ENV: "PRODUCTION", ...uat }), null);
  assert.deepEqual(missingPhonePeSecrets({ ENVIRONMENT: "production", PHONEPE_ENV: "PRODUCTION", ...uat }),
    ["PHONEPE_PROD_CLIENT_ID", "PHONEPE_PROD_CLIENT_SECRET", "PHONEPE_PROD_CLIENT_VERSION", "PHONEPE_PROD_WEBHOOK_USERNAME", "PHONEPE_PROD_WEBHOOK_PASSWORD"]);
  assert.deepEqual(missingPhonePeSecrets({ ...uat }), []);
});

function recorder(responses: Record<string, unknown>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (!key) return new Response("{}", { status: 404 });
    const v = responses[key] as any;
    return new Response(JSON.stringify(v.body ?? v), { status: v.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, seen };
}

const cfg = (environment: "UAT" | "PRODUCTION"): PhonePeConfig => ({ environment, clientId: "id", clientSecret: "sec", clientVersion: "1", webhookUsername: "user", webhookPassword: "pass" });

test("token is fetched with client credentials from the right host and cached", async () => {
  const { f, seen } = recorder({ "/v1/oauth/token": { access_token: "T1", expires_at: Math.floor(Date.now() / 1000) + 3600 } });
  const store = new Map<string, string>();
  const cache = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } };
  assert.equal(await phonePeToken(cfg("UAT"), cache, f), "T1");
  assert.equal(await phonePeToken(cfg("UAT"), cache, f), "T1");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token");
  assert.equal(String(seen[0].init.body), "client_id=id&client_version=1&client_secret=sec&grant_type=client_credentials");

  const p = recorder({ "/v1/oauth/token": { access_token: "P1", expires_at: 0 } });
  await phonePeToken(cfg("PRODUCTION"), undefined, p.f);
  assert.equal(p.seen[0].url, "https://api.phonepe.com/apis/identity-manager/v1/oauth/token");
});

test("pay / status / refund requests follow PG v2", async () => {
  const { f, seen } = recorder({
    "/v1/oauth/token": { access_token: "T", expires_at: 0 },
    "/checkout/v2/pay": { orderId: "OMO1", state: "PENDING", redirectUrl: "https://mercury/pay" },
    "/status": { orderId: "OMO1", state: "COMPLETED", amount: 12345, paymentDetails: [{ transactionId: "TX1", state: "COMPLETED" }] },
    "/payments/v2/refund": { refundId: "R1", state: "PENDING", amount: 100 },
  });
  const order = await createPhonePePayment(cfg("PRODUCTION"), undefined, { merchantOrderId: "TCF_1", amountPaise: 12345, redirectUrl: "https://tripcod.com/r", message: "x" }, f);
  assert.equal(order.redirectUrl, "https://mercury/pay");
  const pay = seen.find((s) => s.url.endsWith("/checkout/v2/pay"))!;
  assert.equal(pay.url, "https://api.phonepe.com/apis/pg/checkout/v2/pay");
  assert.equal((pay.init.headers as any).Authorization, "O-Bearer T");
  const body = JSON.parse(String(pay.init.body));
  assert.deepEqual({ id: body.merchantOrderId, amount: body.amount, type: body.paymentFlow.type, redirect: body.paymentFlow.merchantUrls.redirectUrl },
    { id: "TCF_1", amount: 12345, type: "PG_CHECKOUT", redirect: "https://tripcod.com/r" });

  const st = await phonePeOrderStatus(cfg("PRODUCTION"), undefined, "TCF_1", f);
  assert.equal(st.state, "COMPLETED");
  assert.ok(seen.some((s) => s.url === "https://api.phonepe.com/apis/pg/checkout/v2/order/TCF_1/status?details=false"));

  const rf = await refundPhonePe(cfg("PRODUCTION"), undefined, { merchantRefundId: "RF_TCF_1_0", merchantOrderId: "TCF_1", amountPaise: 100 }, f);
  assert.equal(rf.state, "PENDING");
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.init.body)), { merchantRefundId: "RF_TCF_1_0", originalMerchantOrderId: "TCF_1", amount: 100 });

  await assert.rejects(createPhonePePayment(cfg("UAT"), undefined, { merchantOrderId: "x", amountPaise: 50, redirectUrl: "r", message: "m" }, f), PhonePeError);
});

test("gateway errors are definite, network errors are not", async () => {
  const bad = recorder({ "/v1/oauth/token": { status: 401, body: { code: "UNAUTHORIZED", message: "bad creds" } } });
  await assert.rejects(phonePeToken(cfg("UAT"), undefined, bad.f), (e: any) => e instanceof PhonePeError && e.definite && e.httpStatus === 401);
  const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(phonePeToken(cfg("UAT"), undefined, down), (e: any) => e instanceof PhonePeError && !e.definite);
});

test("webhook Authorization is SHA256(username:password)", async () => {
  const hex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("user:pass"))), (b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyPhonePeWebhook(cfg("UAT"), hex), true);
  assert.equal(await verifyPhonePeWebhook(cfg("UAT"), `SHA256 ${hex.toUpperCase()}`), true);
  assert.equal(await verifyPhonePeWebhook(cfg("UAT"), hex.slice(0, -1) + (hex.endsWith("0") ? "1" : "0")), false);
  assert.equal(await verifyPhonePeWebhook(cfg("UAT"), undefined), false);
  assert.equal(await verifyPhonePeWebhook({ ...cfg("UAT"), webhookPassword: undefined }, hex), false);
});

test("merchant order ids fit PhonePe's format; ledger payloads are redacted", () => {
  const id = newMerchantOrderId("TCH", "UAT");
  assert.match(id, /^TCHU_[A-Z0-9_]+$/);
  assert.ok(id.length <= 63);
  assert.notEqual(newMerchantOrderId("TCF", "UAT"), newMerchantOrderId("TCF", "UAT"));
  // The environment travels with the id (hotel orders in D1 have no environment column).
  assert.equal(merchantOrderEnvironment(newMerchantOrderId("TCF", "PRODUCTION")), "PRODUCTION");
  assert.equal(merchantOrderEnvironment(id), "UAT");
  assert.equal(merchantOrderEnvironment("lnk_123"), null);
  assert.deepEqual(redact({ amount: 5, card: { number: "4111" }, nested: { vpa: "a@ybl", ok: "x" }, Authorization: "abc" }),
    { amount: 5, card: "[redacted]", nested: { vpa: "[redacted]", ok: "x" }, Authorization: "[redacted]" });
});
