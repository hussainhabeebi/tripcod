import test from "node:test";
import assert from "node:assert/strict";
import { syncCityIndex, cityIndexStatus, readCityMatches, CITY_INDEX_KEY } from "../src/lib/hotel-city-sync.js";
const PROGRESS = "hotel-static/city-regions.sync-v2.json";
const LEGACY = "hotel-static/city-regions.partial.json";
function fixture() {
  const data = new Map<string, { text: string; etag: string; customMetadata?: Record<string, string> }>();
  const reads: string[] = [];
  let version = 0;
  let reject: ((key: string) => boolean) | null = null;
  const r2 = {
    get: async (key: string) => { reads.push(key); const obj = data.get(key); return obj ? { ...obj, body: obj.text, json: async () => JSON.parse(obj.text) } : null; },
    head: async (key: string) => data.get(key) ?? null,
    put: async (key: string, text: string, options: any = {}) => {
      if (reject?.(key)) throw new Error("Simulated storage write failure");
      const old = data.get(key);
      if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== old?.etag) return null;
      if (options.onlyIf?.etagDoesNotMatch === "*" && old) return null;
      const obj = { text, etag: String(++version), customMetadata: options.customMetadata };
      data.set(key, obj); return obj;
    },
    delete: async () => { throw new Error("Existing hotel data must not be deleted"); },
  };
  return { env: { DOCUMENTS_R2: r2 } as any, data, reads, fail: (fn: typeof reject) => { reject = fn; }, state: () => JSON.parse(data.get(PROGRESS)!.text) };
}
const page = (id: number, more: boolean, cursor?: string) => ({ hotelCityRegionIds: [{ cityName: "Dubai", cityRegionId: id, countryName: "United Arab Emirates" }], hasMore: more, nextCursor: cursor });
test("128-page legacy checkpoint migrates without downloading any completed page or deleting data", async () => {
  const f = fixture();
  const cities: Record<string, [number, string][]> = {};
  for (let c = 0; c < 2000; c++) cities[`CITY${c}`] = Array.from({ length: 128 }, (_, i) => [c * 128 + i + 1, "COUNTRY"]);
  await f.env.DOCUMENTS_R2.put(LEGACY, JSON.stringify({ cities, pages: 128, count: 256000, cursor: "next-129" }));
  const original = f.data.get(LEGACY)!.text;
  const seen: (string | undefined)[] = [];
  const client = { cityRegionIds: async (_limit: number, cursor?: string) => { seen.push(cursor); return page(999999, false); } };
  for (let i = 0; i < 16; i++) {
    const result = await syncCityIndex(f.env, client);
    assert.equal(result.pages, 128); assert.equal(result.regions, 256000);
  }
  assert.deepEqual(seen, []);
  const done = await syncCityIndex(f.env, client);
  assert.equal(done.done, true); assert.deepEqual(seen, ["next-129"]);
  assert.equal(done.pages, 129); assert.equal(done.regions, 256001);
  assert.equal(f.data.get(LEGACY)!.text, original);
  f.reads.length = 0;
  assert.deepEqual(await readCityMatches(f.env, ["DUBAI"]), [[999999, "UNITED ARAB EMIRATES"]]);
  assert.equal(f.reads.length, 2, "a city lookup reads only the manifest and one shard");
  await syncCityIndex(f.env, client);
  assert.equal(seen.length, 1, "a lost final reply cannot restart the supplier download");
});
test("supplier 429 preserves checkpoint and identifies the exact next page", async () => {
  const f = fixture();
  await syncCityIndex(f.env, { cityRegionIds: async () => page(1, true, "cursor2") });
  const before = f.data.get(PROGRESS)!.text;
  await assert.rejects(syncCityIndex(f.env, { cityRegionIds: async () => { throw Object.assign(new Error("Rate limited"), { statusCode: 429, code: "RATE_LIMIT", gatewayRequestId: "synthetic-id" }); } }), (e: any) => {
    assert.equal(e.syncPage, 2); assert.equal(e.pagesDone, 1); assert.equal(e.statusCode, 429); assert.equal(e.gatewayRequestId, "synthetic-id"); return true;
  });
  assert.equal(f.data.get(PROGRESS)!.text, before);
});
test("checkpoint write failure cannot publish a partial page or count duplicate regions", async () => {
  const f = fixture();
  const client = { cityRegionIds: async (_limit: number, cursor?: string) => cursor ? page(1, false) : page(1, true, "cursor2") };
  await syncCityIndex(f.env, client);
  f.fail((key) => key === PROGRESS);
  await assert.rejects(syncCityIndex(f.env, client));
  assert.equal(f.state().pages, 1);
  assert.equal(f.data.has(CITY_INDEX_KEY), false);
  f.fail(null);
  const done = await syncCityIndex(f.env, client);
  assert.equal(done.regions, 1); assert.equal(done.pages, 2);
});
test("publication failure resumes finalization without re-fetching the terminal page", async () => {
  const f = fixture(); let calls = 0;
  const client = { cityRegionIds: async () => { calls++; return page(1, false); } };
  f.fail((key) => key === CITY_INDEX_KEY);
  await assert.rejects(syncCityIndex(f.env, client), (e: any) => e.code === "CITY_INDEX_PUBLISH_FAILED");
  assert.equal(f.state().exhausted, true);
  f.fail(null);
  assert.equal((await syncCityIndex(f.env, client)).done, true); assert.equal(calls, 1);
});
test("malformed, missing or repeated cursors cannot falsely complete or advance sync", async () => {
  const f = fixture();
  await syncCityIndex(f.env, { cityRegionIds: async () => page(1, true, "cursor2") });
  for (const response of [{ ...page(2, true, "cursor2") }, { ...page(2, true), nextCursor: undefined }, {}, { hotelCityRegionIds: [], hasMore: true, nextCursor: "cursor3" }]) {
    await assert.rejects(syncCityIndex(f.env, { cityRegionIds: async () => response as any }), (e: any) => e.code === "CITY_PAGINATION_INVALID");
    assert.equal(f.state().pages, 1);
  }
});
test("restart is refused while saved progress exists, and old completed indexes remain readable", async () => {
  const f = fixture();
  await f.env.DOCUMENTS_R2.put("hotel-static/city-regions.json", JSON.stringify({ cities: { DUBAI: [[42, "UNITED ARAB EMIRATES"]] } }), { customMetadata: { count: "1", builtAt: "old" } });
  await syncCityIndex(f.env, { cityRegionIds: async () => page(1, true, "cursor2") });
  await assert.rejects(syncCityIndex(f.env, { cityRegionIds: async () => { throw new Error("No supplier call allowed"); } }, true), (e: any) => e.code === "SYNC_RESTART_BLOCKED");
  assert.deepEqual(await readCityMatches(f.env, ["DUBAI"]), [[42, "UNITED ARAB EMIRATES"]]);
  assert.equal((await cityIndexStatus(f.env)).ready, true);
});
test("concurrent invocations cannot regress the durable cursor", async () => {
  const f = fixture();
  await syncCityIndex(f.env, { cityRegionIds: async () => page(1, true, "cursor2") });
  let release!: () => void;
  const wait = new Promise<void>((r) => { release = r; });
  const slow = syncCityIndex(f.env, { cityRegionIds: async () => { await wait; return page(2, true, "cursor3"); } });
  await syncCityIndex(f.env, { cityRegionIds: async () => page(2, true, "cursor3") });
  release();
  await assert.rejects(slow, (e: any) => e.code === "SYNC_CONFLICT");
  assert.equal(f.state().pages, 2); assert.equal(f.state().cursor, "cursor3");
});
test("missing legacy cursor cannot silently re-download page one", async () => {
  const f = fixture();
  await f.env.DOCUMENTS_R2.put(LEGACY, JSON.stringify({ pages: 128, count: 256000, cities: {} }));
  await assert.rejects(syncCityIndex(f.env, { cityRegionIds: async () => { throw new Error("No supplier request permitted"); } }), (e: any) => e.code === "SYNC_CHECKPOINT_INVALID");
  assert.equal(f.data.has(PROGRESS), false);
});
test("an empty new index does not replace an existing completed index", async () => {
  const f = fixture();
  await f.env.DOCUMENTS_R2.put("hotel-static/city-regions.json", JSON.stringify({ cities: { DUBAI: [[42, "UNITED ARAB EMIRATES"]] } }));
  await assert.rejects(syncCityIndex(f.env, { cityRegionIds: async () => ({ hotelCityRegionIds: [], hasMore: false }) }));
  assert.equal(f.data.has(CITY_INDEX_KEY), false);
  assert.deepEqual(await readCityMatches(f.env, ["DUBAI"]), [[42, "UNITED ARAB EMIRATES"]]);
});
test("a multi-page cursor cycle stops without overwriting the last committed cursor", async () => {
  const f = fixture(); let i = 0;
  const client = { cityRegionIds: async () => page(++i, true, i === 2 ? "third" : "second") };
  await syncCityIndex(f.env, client); await syncCityIndex(f.env, client);
  await assert.rejects(syncCityIndex(f.env, client), (e: any) => e.code === "CITY_PAGINATION_INVALID");
  assert.equal(f.state().pages, 2);
});
test("Admin failure response and Supplier Log correlate HTTP status, page and gateway ID", async (t) => {
  const { Hono } = await import("hono");
  const { hotelsAdminRoutes } = await import("../src/routes/admin/hotels.js");
  const f = fixture();
  await syncCityIndex(f.env, { cityRegionIds: async () => page(1, true, "cursor2") });
  const logs: any[] = [];
  const app = new Hono<any>();
  app.use("*", async (c, next) => { c.set("tenantId", "synthetic-tenant"); c.set("db", { insert: () => ({ values: async (v: any) => { logs.push(v); } }) }); await next(); });
  app.route("/admin", hotelsAdminRoutes);
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async () => Response.json({ errors: [{ errCode: "synthetic-code", message: "Not authorised" }] }, { status: 403, headers: { "x-request-id": "synthetic-gateway", "x-tripjack-upstream-status": "403" } });
  const env = { ...f.env, TENANT_CACHE_KV: { get: async () => null }, TRIPJACK_API_BASE_URL: "https://gateway.invalid", TRIPJACK_API_KEY: "synthetic-key", TRIPJACK_PROXY_KEY: "synthetic-internal" };
  const response = await app.fetch(new Request("http://local/admin/city-index/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restart: false }) }), env, { waitUntil() {}, passThroughOnException() {} } as any);
  const body: any = await response.json();
  assert.equal(body.httpStatus, 403); assert.equal(body.upstreamStatus, 403); assert.equal(body.page, 2);
  assert.equal(body.pagesDone, 1); assert.equal(body.errorCode, "synthetic-code"); assert.equal(body.gatewayRequestId, "synthetic-gateway");
  assert.ok(body.requestId);
  const entry = logs.find((x) => x.level === "ERROR");
  assert.equal(entry.requestId, body.requestId); assert.equal(entry.requestSummary.syncPage, 2); assert.equal(entry.requestSummary.gatewayRequestId, "synthetic-gateway");
  assert.equal(JSON.stringify(body).includes("synthetic-key"), false);
  assert.equal(f.state().pages, 1);
});
