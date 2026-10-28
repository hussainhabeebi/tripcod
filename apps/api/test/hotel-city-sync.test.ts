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
    get: async (key: string) => { reads.push(key); const obj = data.get(key); return obj ? { ...obj, size: new TextEncoder().encode(obj.text).length, body: new Blob([obj.text]).stream(), json: async () => JSON.parse(obj.text) } : null; },
    head: async (key: string) => data.get(key) ?? null,
    put: async (key: string, text: string, options: any = {}) => {
      if (reject?.(key)) throw new Error("Simulated storage write failure");
      if (typeof text !== "string") text = await new Response(text).text();
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
  for (let i = 0; i < 17; i++) {
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
test("legacy completed cities remain available throughout migration and publication without rewriting legacy objects", async () => {
  const f = fixture();
  const oldKey = "hotel-static/city-regions.json";
  const cities = { DUBAI: [[42, "UNITED ARAB EMIRATES"]] };
  await f.env.DOCUMENTS_R2.put(oldKey, JSON.stringify({ cities, builtAt: "original", count: 1 }), { customMetadata: { builtAt: "original", count: "1" } });
  await f.env.DOCUMENTS_R2.put(LEGACY, JSON.stringify({ cities, pages: 128, count: 1, cursor: "saved-next-page" }));
  const beforeDone = { ...f.data.get(oldKey)! }, beforePartial = { ...f.data.get(LEGACY)! };
  let requests = 0;
  const client = { cityRegionIds: async (_limit: number, cursor?: string) => {
    requests++; assert.equal(cursor, "saved-next-page");
    return { hotelCityRegionIds: [{ cityName: "Kochi", cityRegionId: 55, countryName: "India" }], hasMore: false };
  } };
  for (let i = 0; i < 17; i++) {
    const result = await syncCityIndex(f.env, client);
    assert.equal(result.pages, 128); assert.equal(requests, 0);
    assert.deepEqual(await readCityMatches(f.env, ["DUBAI"]), [[42, "UNITED ARAB EMIRATES"]]);
    assert.equal((await cityIndexStatus(f.env)).ready, true);
  }
  assert.equal((await syncCityIndex(f.env, client)).done, true);
  assert.deepEqual(await readCityMatches(f.env, ["DUBAI", "KOCHI"]), [[42, "UNITED ARAB EMIRATES"], [55, "INDIA"]]);
  assert.deepEqual(f.data.get(oldKey), beforeDone);
  assert.deepEqual(f.data.get(LEGACY), beforePartial);
});
test("a partial refresh of v2 keeps the previous completed v2 catalogue accessible", async () => {
  const f = fixture();
  await syncCityIndex(f.env, { cityRegionIds: async () => page(42, false) });
  const published = { ...f.data.get(CITY_INDEX_KEY)! };
  await syncCityIndex(f.env, { cityRegionIds: async () => ({ hotelCityRegionIds: [{ cityName: "Kochi", cityRegionId: 55, countryName: "India" }], hasMore: true, nextCursor: "refresh-next" }) }, true);
  assert.deepEqual(f.data.get(CITY_INDEX_KEY), published);
  assert.deepEqual(await readCityMatches(f.env, ["KOCHI"]), [[55, "INDIA"]]);
  assert.deepEqual(await readCityMatches(f.env, ["DUBAI"]), [[42, "UNITED ARAB EMIRATES"]]);
  const status = await cityIndexStatus(f.env);
  assert.equal(status.ready, true); assert.equal(status.inProgress, true);
});

test("partial legacy and partially migrated cities can be searched before final publication", async () => {
  const f = fixture();
  await f.env.DOCUMENTS_R2.put(LEGACY, JSON.stringify({ cities: { DUBAI: [[42, "UNITED ARAB EMIRATES"]] }, pages: 128, count: 1, cursor: "next-129" }));
  assert.deepEqual(await readCityMatches(f.env, ["DUBAI"]), [[42, "UNITED ARAB EMIRATES"]]);
  const client = { cityRegionIds: async () => { throw new Error("Supplier must not be called while migrating"); } };
  await syncCityIndex(f.env, client);
  await syncCityIndex(f.env, client);
  assert.deepEqual(await readCityMatches(f.env, ["DUBAI"]), [[42, "UNITED ARAB EMIRATES"]]);
  assert.equal(f.data.has(CITY_INDEX_KEY), false);
});
test("a committed supplier page is searchable before the catalogue completes", async () => {
  const f = fixture();
  await syncCityIndex(f.env, { cityRegionIds: async () => page(42, true, "next-2") });
  assert.deepEqual(await readCityMatches(f.env, ["DUBAI"]), [[42, "UNITED ARAB EMIRATES"]]);
  await assert.rejects(readCityMatches(f.env, ["UNSYNCED"]), (e: any) => e.code === "CITY_NOT_SYNCED");
});
test("streaming legacy parser handles UTF-8, escaped keys and metadata after cities without buffering the object", async () => {
  const { scanLegacyCities } = await import("../src/lib/hotel-city-legacy.js");
  const text = JSON.stringify({ cities: { 'دبي "Dubai"': [[42, "AE"]], '__proto__': [] }, pages: 128, count: 1, cursor: "next-129" });
  const bytes = new TextEncoder().encode(text); let offset = 0;
  const found: any[] = [];
  const metadata = await scanLegacyCities({ body: new ReadableStream({ pull(c) { if (offset === bytes.length) return c.close(); c.enqueue(bytes.slice(offset, ++offset)); } }) }, (name, rows) => found.push([name, rows]));
  assert.equal(metadata.pages, 128); assert.equal(metadata.cursor, "next-129");
  assert.deepEqual(found, [['دبي "Dubai"', [[42, "AE"]]]]);
});
test("invalid or oversized legacy entries stop without advancing progress or touching originals", async () => {
  for (const text of [
    '{"cities":{"DUBAI":[[1,"AE"]]},"pages":128,"count":1,"cursor":"next"',
    JSON.stringify({ cities: { DUBAI: [[1, "X".repeat(140000)]] }, pages: 128, count: 1, cursor: "next" }),
    '{"cities":{},"pages":128,"pages":0,"count":0,"cursor":"next"}',
  ]) {
    const f = fixture(); await f.env.DOCUMENTS_R2.put(LEGACY, text);
    await assert.rejects(syncCityIndex(f.env, { cityRegionIds: async () => { throw new Error("Forbidden"); } }), (e: any) => e.code === "SYNC_CHECKPOINT_INVALID");
    assert.equal(f.data.has(PROGRESS), false); assert.equal(f.data.get(LEGACY)?.text, text);
  }
});
test("stream failure preserves the legacy source and cannot request page one", async () => {
  const f = fixture(); await f.env.DOCUMENTS_R2.put(LEGACY, JSON.stringify({ cities: { DUBAI: [[42, "AE"]] }, pages: 128, count: 1, cursor: "next" }));
  const client = { cityRegionIds: async () => { throw new Error("Forbidden"); } };
  await syncCityIndex(f.env, client);
  const before = f.data.get(PROGRESS)!.text;
  const get = f.env.DOCUMENTS_R2.get;
  f.env.DOCUMENTS_R2.get = async (key: string) => key === f.state().legacySource ? { body: new ReadableStream({ start(c) { c.error(new Error("Interrupted R2 stream")); } }) } : get(key);
  await assert.rejects(syncCityIndex(f.env, client), /Interrupted R2 stream/);
  assert.equal(f.data.get(PROGRESS)!.text, before);
});
test("oversized v2 shards fail safely without consuming their bodies", async () => {
  const f = fixture(); await syncCityIndex(f.env, { cityRegionIds: async () => page(42, true, "next") });
  const get = f.env.DOCUMENTS_R2.get;
  f.env.DOCUMENTS_R2.get = async (key: string) => { const obj = await get(key); if (obj && key !== PROGRESS) return { ...obj, size: 3 * 1024 * 1024, json: () => { throw new Error("Oversized body parsed"); } }; return obj; };
  const before = f.data.get(PROGRESS)!.text;
  await assert.rejects(syncCityIndex(f.env, { cityRegionIds: async () => page(43, false) }), (e: any) => e.code === "CITY_SHARD_LIMIT");
  assert.equal(f.data.get(PROGRESS)!.text, before);
});
test("migration shard cap stops safely with the original page-129 cursor intact", async () => {
  const f = fixture(); const cities: Record<string, any> = {};
  const hash = (name: string) => { let n = 0; for (const c of name) n = (n * 31 + c.charCodeAt(0)) >>> 0; return n % 16; };
  for (let i = 0, added = 0; added < 23; i++) if (hash(`CITY${i}`) === 0) cities[`CITY${i}`] = [[++added, "X".repeat(100000)]];
  await f.env.DOCUMENTS_R2.put(LEGACY, JSON.stringify({ cities, pages: 128, count: 23, cursor: "next-129" }));
  const client = { cityRegionIds: async () => { throw new Error("Forbidden"); } };
  await syncCityIndex(f.env, client); const before = f.data.get(PROGRESS)!.text;
  await assert.rejects(syncCityIndex(f.env, client), (e: any) => e.code === "CITY_SHARD_LIMIT");
  assert.equal(f.data.get(PROGRESS)!.text, before); assert.equal(f.state().cursor, "next-129");
});
test("hotel search resolves a saved partial city through mapping and listing without a completed catalogue", async () => {
  const { searchHotels } = await import("../src/lib/hotels.js");
  const f = fixture();
  await f.env.DOCUMENTS_R2.put(LEGACY, JSON.stringify({ cities: { DUBAI: [[42, "UNITED ARAB EMIRATES"]] }, pages: 128, count: 1, cursor: "next-129" }));
  const calls: string[] = [];
  const client = {
    hotelMapping: async (input: any) => { calls.push("mapping"); assert.deepEqual(input.regionIds, ["42"]); return { hotels: [{ tjHotelId: "100000569607" }] }; },
    listing: async (input: any) => { calls.push("listing"); assert.deepEqual(input.hids, ["100000569607"]); return { hotels: [{ hotelId: "100000569607", name: "Synthetic hotel", options: [{ optionId: "synthetic-option", pricing: { totalPrice: 100, currency: "INR" } }] }] }; },
    hotelContent: async () => { calls.push("content"); return { hotels: [] }; },
  };
  const result = await searchHotels({ ...f.env, FARE_CACHE_KV: { get: async () => null, put: async () => {} } }, client as any,
    { cityCode: "DXB", checkIn: "2026-11-10", checkOut: "2026-11-12", rooms: [{ adults: 1, children: 0 }], nationality: "106", currency: "INR" });
  assert.equal(result.hotels.length, 1); assert.equal(result.hotels[0].hid, "100000569607");
  assert.deepEqual(calls, ["mapping", "listing", "content"]); assert.equal(f.data.has(CITY_INDEX_KEY), false);
});

test("multiple progress writes within one invocation are spaced for R2 per-key limits", async () => {
  const f = fixture(); const put = f.env.DOCUMENTS_R2.put; const times: number[] = [];
  f.env.DOCUMENTS_R2.put = async (key: string, value: any, options: any) => {
    if (key === PROGRESS) times.push(Date.now());
    return put(key, value, options);
  };
  await syncCityIndex(f.env, { cityRegionIds: async () => page(42, false) });
  assert.equal(times.length, 3);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i-1] >= 1000, "progress writes must be at least one second apart");
});
