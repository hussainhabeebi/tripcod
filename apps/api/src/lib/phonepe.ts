// PhonePe Payment Gateway v2 (Standard Checkout): OAuth client-credentials token,
// create payment, order status, refund, refund status and webhook authorization.
//
// UAT and Production are fully separate: each has its own client id / secret /
// version / webhook user, read from Worker secrets with a PHONEPE_UAT_ or
// PHONEPE_PROD_ prefix. Production credentials are only used when the Worker
// itself is production (ENVIRONMENT=production) AND PHONEPE_ENV=PRODUCTION, so a
// staging/dev Worker can never charge real money, and there is never a fallback
// from one environment's credentials to the other's.

export type PhonePeEnvironment = "UAT" | "PRODUCTION";

export const PHONEPE_HOSTS: Record<PhonePeEnvironment, { auth: string; pg: string }> = {
  UAT: {
    auth: "https://api-preprod.phonepe.com/apis/pg-sandbox",
    pg:   "https://api-preprod.phonepe.com/apis/pg-sandbox",
  },
  PRODUCTION: {
    auth: "https://api.phonepe.com/apis/identity-manager",
    pg:   "https://api.phonepe.com/apis/pg",
  },
};

export interface PhonePeConfig {
  environment:      PhonePeEnvironment;
  clientId:         string;
  clientSecret:     string;
  clientVersion:    string;
  webhookUsername?: string;
  webhookPassword?: string;
}

export type PhonePeEnv = {
  ENVIRONMENT?: string;
  PHONEPE_ENV?: string;
  PHONEPE_UAT_CLIENT_ID?: string;
  PHONEPE_UAT_CLIENT_SECRET?: string;
  PHONEPE_UAT_CLIENT_VERSION?: string;
  PHONEPE_UAT_WEBHOOK_USERNAME?: string;
  PHONEPE_UAT_WEBHOOK_PASSWORD?: string;
  PHONEPE_PROD_CLIENT_ID?: string;
  PHONEPE_PROD_CLIENT_SECRET?: string;
  PHONEPE_PROD_CLIENT_VERSION?: string;
  PHONEPE_PROD_WEBHOOK_USERNAME?: string;
  PHONEPE_PROD_WEBHOOK_PASSWORD?: string;
};

export function phonePeEnvironment(env: PhonePeEnv): PhonePeEnvironment {
  return env.PHONEPE_ENV?.toUpperCase() === "PRODUCTION" && env.ENVIRONMENT === "production" ? "PRODUCTION" : "UAT";
}

// Which secrets are missing for the active environment (names only, never values).
export function missingPhonePeSecrets(env: PhonePeEnv): string[] {
  const p = phonePeEnvironment(env) === "PRODUCTION" ? "PHONEPE_PROD_" : "PHONEPE_UAT_";
  return ["CLIENT_ID", "CLIENT_SECRET", "CLIENT_VERSION", "WEBHOOK_USERNAME", "WEBHOOK_PASSWORD"]
    .map((k) => `${p}${k}`)
    .filter((k) => !(env as Record<string, string | undefined>)[k]);
}

export function resolvePhonePeConfig(env: PhonePeEnv): PhonePeConfig | null {
  const environment = phonePeEnvironment(env);
  const pick = environment === "PRODUCTION"
    ? { id: env.PHONEPE_PROD_CLIENT_ID, secret: env.PHONEPE_PROD_CLIENT_SECRET, version: env.PHONEPE_PROD_CLIENT_VERSION, user: env.PHONEPE_PROD_WEBHOOK_USERNAME, pass: env.PHONEPE_PROD_WEBHOOK_PASSWORD }
    : { id: env.PHONEPE_UAT_CLIENT_ID, secret: env.PHONEPE_UAT_CLIENT_SECRET, version: env.PHONEPE_UAT_CLIENT_VERSION, user: env.PHONEPE_UAT_WEBHOOK_USERNAME, pass: env.PHONEPE_UAT_WEBHOOK_PASSWORD };
  if (!pick.id || !pick.secret || !pick.version) return null;
  return { environment, clientId: pick.id, clientSecret: pick.secret, clientVersion: pick.version, webhookUsername: pick.user, webhookPassword: pick.pass };
}

type Fetch = typeof fetch;
type TokenCache = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };

export class PhonePeError extends Error {
  constructor(message: string, public httpStatus: number | null, public code?: string, public definite = httpStatus !== null) {
    super(message);
    this.name = "PhonePeError";
  }
}

async function call(f: Fetch, url: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new PhonePeError(`PhonePe unreachable: ${err instanceof Error ? err.message : String(err)}`, null, undefined, false);
  }
  const text = await res.text().catch(() => "");
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = (body?.message ?? body?.error ?? text ?? "").toString().slice(0, 300) || `HTTP ${res.status}`;
    throw new PhonePeError(`PhonePe HTTP ${res.status}: ${msg}`, res.status, body?.code);
  }
  return body ?? {};
}

// O-Bearer access token, cached in KV until shortly before it expires.
export async function phonePeToken(cfg: PhonePeConfig, cache?: TokenCache, f: Fetch = fetch): Promise<string> {
  const key = `phonepe_token:${cfg.environment}:${cfg.clientId}`;
  const hit = await cache?.get(key).catch(() => null);
  if (hit) return hit;
  const body = new URLSearchParams({
    client_id: cfg.clientId, client_version: cfg.clientVersion, client_secret: cfg.clientSecret, grant_type: "client_credentials",
  });
  const res = await call(f, `${PHONEPE_HOSTS[cfg.environment].auth}/v1/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const token = String(res.access_token ?? "");
  if (!token) throw new PhonePeError("PhonePe returned no access token", 502);
  const ttl = Math.floor(Number(res.expires_at ?? 0) - Date.now() / 1000) - 120;
  if (cache && ttl >= 60) await cache.put(key, token, { expirationTtl: ttl }).catch(() => {});
  return token;
}

// PhonePe merchant ids: up to 63 chars of letters, digits, "_" and "-". The
// environment letter (U / P) travels with the id, so a refund or status check is
// only ever sent with the credentials the order was created with.
export function newMerchantOrderId(prefix: "TCF" | "TCH", environment: PhonePeEnvironment): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}${environment === "PRODUCTION" ? "P" : "U"}_${Date.now().toString(36)}_${rand}`.toUpperCase();
}

export function merchantOrderEnvironment(merchantOrderId: string): PhonePeEnvironment | null {
  const m = /^TC[FH]([UP])_/.exec(merchantOrderId);
  return m ? (m[1] === "P" ? "PRODUCTION" : "UAT") : null;
}

export const toPaise = (rupees: number) => Math.round(rupees * 100);

export interface PhonePeOrder {
  orderId:      string;
  state:        "PENDING" | "COMPLETED" | "FAILED" | string;
  amount:       number;          // paise
  redirectUrl?: string;
  expireAt?:    number;
  paymentDetails?: { transactionId?: string; paymentMode?: string; state?: string; amount?: number; errorCode?: string }[];
  errorCode?:   string;
}

export async function createPhonePePayment(
  cfg: PhonePeConfig, cache: TokenCache | undefined,
  p: { merchantOrderId: string; amountPaise: number; redirectUrl: string; message: string; expireAfterSeconds?: number; udf?: Record<string, string> },
  f: Fetch = fetch,
): Promise<PhonePeOrder> {
  if (!Number.isInteger(p.amountPaise) || p.amountPaise < 100) throw new PhonePeError("PhonePe amount must be at least ₹1", 400);
  const token = await phonePeToken(cfg, cache, f);
  const res = await call(f, `${PHONEPE_HOSTS[cfg.environment].pg}/checkout/v2/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${token}` },
    body: JSON.stringify({
      merchantOrderId: p.merchantOrderId,
      amount: p.amountPaise,
      expireAfter: p.expireAfterSeconds ?? 1200,
      ...(p.udf ? { metaInfo: p.udf } : {}),
      paymentFlow: { type: "PG_CHECKOUT", message: p.message, merchantUrls: { redirectUrl: p.redirectUrl } },
    }),
  });
  if (!res.orderId || !res.redirectUrl) throw new PhonePeError("PhonePe did not return a checkout URL", 502);
  return { orderId: String(res.orderId), state: String(res.state ?? "PENDING"), amount: p.amountPaise, redirectUrl: String(res.redirectUrl), expireAt: res.expireAt };
}

// Source of truth for "was this order paid?" — webhooks only trigger this check.
export async function phonePeOrderStatus(cfg: PhonePeConfig, cache: TokenCache | undefined, merchantOrderId: string, f: Fetch = fetch): Promise<PhonePeOrder> {
  const token = await phonePeToken(cfg, cache, f);
  const res = await call(f, `${PHONEPE_HOSTS[cfg.environment].pg}/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=false`, {
    method: "GET", headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${token}` },
  });
  return {
    orderId: String(res.orderId ?? ""), state: String(res.state ?? "PENDING"), amount: Number(res.amount ?? 0),
    expireAt: res.expireAt, paymentDetails: Array.isArray(res.paymentDetails) ? res.paymentDetails : [], errorCode: res.errorCode,
  };
}

export async function refundPhonePe(
  cfg: PhonePeConfig, cache: TokenCache | undefined,
  p: { merchantRefundId: string; merchantOrderId: string; amountPaise: number },
  f: Fetch = fetch,
): Promise<{ refundId: string; state: string; amount: number }> {
  const token = await phonePeToken(cfg, cache, f);
  const res = await call(f, `${PHONEPE_HOSTS[cfg.environment].pg}/payments/v2/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${token}` },
    body: JSON.stringify({ merchantRefundId: p.merchantRefundId, originalMerchantOrderId: p.merchantOrderId, amount: p.amountPaise }),
  });
  return { refundId: String(res.refundId ?? p.merchantRefundId), state: String(res.state ?? "PENDING"), amount: Number(res.amount ?? p.amountPaise) };
}

export async function phonePeRefundStatus(cfg: PhonePeConfig, cache: TokenCache | undefined, merchantRefundId: string, f: Fetch = fetch) {
  const token = await phonePeToken(cfg, cache, f);
  const res = await call(f, `${PHONEPE_HOSTS[cfg.environment].pg}/payments/v2/refund/${encodeURIComponent(merchantRefundId)}/status`, {
    method: "GET", headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${token}` },
  });
  return { refundId: String(res.refundId ?? ""), state: String(res.state ?? "PENDING"), amount: Number(res.amount ?? 0) };
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// PhonePe sends Authorization: SHA256(username:password) as hex, using the
// webhook user configured on the PhonePe dashboard for this environment.
export async function verifyPhonePeWebhook(cfg: PhonePeConfig, authorization: string | undefined): Promise<boolean> {
  if (!cfg.webhookUsername || !cfg.webhookPassword || !authorization) return false;
  const got = authorization.trim().replace(/^SHA256\s+/i, "").toLowerCase();
  const expected = await sha256Hex(`${cfg.webhookUsername}:${cfg.webhookPassword}`);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
