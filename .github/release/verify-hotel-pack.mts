// Read-only production check of Admin → API Logs → Hotel UAT certification logs.
// Runs the merged Admin route code against the real R2 files and Neon index
// (Cloudflare REST for R2 / KV, Neon over HTTP). Prints metadata only — this
// repository's logs are public: no request / response bodies, names or keys.
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { createDb } from "@tripcod/db";
import { tenants } from "@tripcod/db/schema";
import { eq } from "drizzle-orm";
import { supplierLogsAdminRoutes } from "./src/routes/admin/supplier-logs.js";

const [bookingId] = process.argv.slice(2);
const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const auth = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
const bucket = `${base}/r2/buckets/tripcod-documents/objects`;

// Read-only R2: list (delimiter computed locally) + get.
const R2 = {
  async list({ prefix, delimiter, cursor }: { prefix: string; delimiter?: string; cursor?: string }) {
    const keys: string[] = [];
    let next = cursor;
    do {
      const q = new URLSearchParams({ prefix, per_page: "1000", ...(next ? { cursor: next } : {}) });
      const res = await fetch(`${bucket}?${q}`, { headers: auth });
      const d: any = await res.json();
      if (!d.success) throw new Error(`R2 list failed (${res.status})`);
      keys.push(...d.result.map((o: any) => o.key));
      next = d.result_info?.is_truncated ? d.result_info.cursor : undefined;
    } while (next);
    if (!delimiter) return { objects: keys.map((key) => ({ key })), truncated: false };
    const prefixes = [...new Set(keys.map((k) => k.slice(prefix.length)).filter((r) => r.includes(delimiter)).map((r) => prefix + r.slice(0, r.indexOf(delimiter) + 1)))];
    return { objects: [], delimitedPrefixes: prefixes, truncated: false };
  },
  async get(key: string) {
    const res = await fetch(`${bucket}/${encodeURIComponent(key)}`, { headers: auth });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return { text: async () => new TextDecoder().decode(buf), arrayBuffer: async () => buf };
  },
};
const KV = {
  async get(key: string, type?: string) {
    const res = await fetch(`${base}/storage/kv/namespaces/80e6bb7866794b1ea4eef2e1a4065040/values/${encodeURIComponent(key)}`, { headers: auth });
    if (!res.ok) return null;
    const t = await res.text();
    return type === "json" ? JSON.parse(t) : t;
  },
};

const db = createDb(process.env.DATABASE_URL!);
const [{ id: tenantId }] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, "tripcod")).limit(1);
const app = new Hono<any>();
app.use("*", async (c, n) => { c.set("tenantId", tenantId); c.set("db", db); await n(); });
app.route("/logs", supplierLogsAdminRoutes);
const env = { DOCUMENTS_R2: R2, TENANT_CACHE_KV: KV };
const call = (p: string) => app.fetch(new Request(`http://admin${p}`), env as any, { waitUntil() {}, passThroughOnException() {} } as any);

const t0 = Date.now();
const list = await call("/logs/hotel-certification?limit=100");
console.log("LIST_MS", Date.now() - t0);
const { packs } = await list.json() as any;
console.log("LIST", list.status, JSON.stringify(packs.map((p: any) => ({ bookingId: p.bookingId, scenario: p.scenario, covered: p.covered, missing: p.missing, calls: p.calls, fromSearchLogs: p.searchAndReviewFromSearchLogs }))));
const pack = packs.find((p: any) => p.bookingId === bookingId);
if (!pack) { console.log(`RESULT NOT_LISTED ${bookingId}`); process.exit(1); }

const res = await call(`/logs/hotel-certification/${bookingId}/zip`);
const bytes = new Uint8Array(await res.arrayBuffer());
console.log("ZIP", res.status, res.headers.get("Content-Disposition"), `${bytes.length} bytes`);
// STORE zip → entries
const view = new DataView(bytes.buffer); const files: Record<string, Uint8Array> = {}; let i = 0;
while (i + 30 < bytes.length && view.getUint32(i, true) === 0x04034b50) {
  const size = view.getUint32(i + 18, true), n = view.getUint16(i + 26, true), extra = view.getUint16(i + 28, true);
  const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + n)); const start = i + 30 + n + extra;
  files[name] = bytes.subarray(start, start + size); i = start + size;
}
const problems: string[] = [];
for (const [name, data] of Object.entries(files)) {
  const text = new TextDecoder().decode(data);
  let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  const row: Record<string, unknown> = { file: name, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex").slice(0, 16), validJson: json !== null };
  if (name.endsWith("Request.json")) {
    const u = (() => { try { return new URL(json.url); } catch { return null; } })();
    row.tripjackUrl = u ? `${u.host}${u.pathname}` : null;
    row.hasApiKey = Boolean(json?.headers?.apikey);
    row.gatewaySecretPresent = /x-tripcod-gateway-key/i.test(text);
    if (!u || !u.host.endsWith("tripjack.com")) problems.push(`${name}: not a TripJack URL`);
    if (row.gatewaySecretPresent) problems.push(`${name}: gateway secret present`);
  } else if (name.endsWith("Response.json") && json === null) problems.push(`${name}: response is not JSON`);
  if (name === "HotelBookingSummary.json") Object.assign(row, { scenario: json.scenario, covered: json.covered, missing: json.missing, correlationIds: json.correlationIds?.length });
  console.log("FILE", JSON.stringify(row));
}
if (!files["HotelSearchRequest.json"] || !files["HotelSearchResponse.json"]) problems.push("HotelSearch request/response missing");
console.log(problems.length ? `RESULT ZIP_PROBLEMS ${problems.join("; ")}` : `RESULT VERIFIED ${bookingId}: ${Object.keys(files).length} files, genuine TripJack request/response JSON`);
process.exit(problems.length ? 1 : 0);
