import type { Env } from "../types.js";
import type { TripjackHotelV3Client } from "@tripcod/suppliers";

export const CITY_INDEX_KEY = "hotel-static/city-regions.v2.json";
const LEGACY_INDEX_KEY = "hotel-static/city-regions.json";
const LEGACY_PARTIAL = "hotel-static/city-regions.partial.json";
const PROGRESS = "hotel-static/city-regions.sync-v2.json";
const BUCKETS = 16;
type Cities = Record<string, [number, string][]>;
type State = { version: 2; run: string; pages: number; count: number; cityCount: number; cursor?: string;
  shards: Record<string, string>; migrationBucket: number; legacySource?: string; exhausted?: boolean; complete?: boolean; builtAt?: string; cursorTrail?: string[] };
const fail = (code: string, message: string, context: Record<string, unknown> = {}) => Object.assign(new Error(message), { code, ...context });
function bucket(name: string) { let n = 0; for (let i = 0; i < name.length; i++) n = (n * 31 + name.charCodeAt(i)) >>> 0; return String(n % BUCKETS); }

export async function cityIndexStatus(env: Env) {
  const [done, manifest] = await Promise.all([(async () => await env.DOCUMENTS_R2.head(CITY_INDEX_KEY) ?? await env.DOCUMENTS_R2.head(LEGACY_INDEX_KEY))(), env.DOCUMENTS_R2.get(PROGRESS)]);
  const state = manifest ? await manifest.json() as State : null;
  const old = !state ? await env.DOCUMENTS_R2.get(LEGACY_PARTIAL) : null;
  const legacy = old ? await old.json() as { pages: number; count: number } : null;
  return { ready: !!done, builtAt: done?.customMetadata?.builtAt ?? null, cities: Number(done?.customMetadata?.count ?? 0),
    inProgress: state ? !state.complete : !!legacy, pagesDone: state?.pages ?? legacy?.pages ?? 0,
    regionsSoFar: state?.count ?? legacy?.count ?? 0,
    phase: state && state.migrationBucket < BUCKETS ? "Migrating saved checkpoint" : "Syncing pages" };
}

// One supplier page per invocation. Immutable shard revisions are published by a
// conditional manifest write; a failed write never advances the durable cursor.
export async function syncCityIndex(env: Env, client: Pick<TripjackHotelV3Client, "cityRegionIds">, restart = false) {
  try { return await runSync(env, client, restart); } catch (err) {
    const error = err instanceof Error ? err : new Error("City sync failed");
    if (!(error as { syncPhase?: string }).syncPhase) Object.assign(error, { syncPhase: "checkpoint" });
    throw error;
  }
}

async function runSync(env: Env, client: Pick<TripjackHotelV3Client, "cityRegionIds">, restart: boolean) {
  const object = await env.DOCUMENTS_R2.get(PROGRESS);
  let etag = object?.etag;
  let state = object ? await object.json() as State : null;
  let initializedLegacy = false;
  if (restart && state && !state.complete) throw fail("SYNC_RESTART_BLOCKED", "Sync is incomplete. Continue without resetting saved progress.");
  if (!state || restart) {
    const old = !state ? await env.DOCUMENTS_R2.get(LEGACY_PARTIAL) : null;
    const run = crypto.randomUUID();
    const source = old ? `hotel-static/city-sync/${run}/legacy-base.json` : undefined;
    if (old && source) await env.DOCUMENTS_R2.put(source, old.body);
    const snapshot = source ? await env.DOCUMENTS_R2.get(source) : null;
    if (source && !snapshot) throw fail("SYNC_CHECKPOINT_MISSING", "The saved checkpoint snapshot could not be read.");
    const legacy = snapshot ? await snapshot.json() as { pages: number; count: number; cursor?: string; cities: Cities } : null;
    if (legacy?.pages && !legacy.cursor) throw fail("SYNC_CHECKPOINT_INVALID", "The saved cursor is missing. Preserve the checkpoint and inspect logs; do not restart.");
    if (restart && legacy?.pages) throw fail("SYNC_RESTART_BLOCKED", "Existing city pages are saved. Use Continue sync.");
    state = { version: 2, run, pages: legacy?.pages ?? 0, count: legacy?.count ?? 0,
      cityCount: legacy ? Object.keys(legacy.cities).length : 0, cursor: legacy?.cursor, shards: {},
      migrationBucket: legacy ? 0 : BUCKETS, ...(legacy ? { legacySource: source } : {}) };
    await checkpoint(state);
    initializedLegacy = !!legacy;
  }
  const current = state;
  async function checkpoint(next: State) {
    const saved = await env.DOCUMENTS_R2.put(PROGRESS, JSON.stringify(next), {
      onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
    });
    if (!saved) throw fail("SYNC_CONFLICT", "Another administrator advanced the sync. Refresh status and continue.");
    etag = saved.etag;
  }
  const result = () => ({ done: !!current.complete, pages: current.pages, regions: current.count, cities: current.cityCount,
    phase: current.migrationBucket < BUCKETS ? "Migrating saved checkpoint" : "Syncing pages" });
  // Return before extracting a shard: do not parse the large legacy source twice in one invocation.
  if (current.complete || initializedLegacy) return result();
  if (current.migrationBucket < BUCKETS) {
    try {
    // The original checkpoint remains untouched and available for recovery.
    const old = await env.DOCUMENTS_R2.get(current.legacySource!);
    if (!old) throw fail("SYNC_CHECKPOINT_MISSING", "The original city checkpoint is missing. Do not restart.");
    const legacy = await old.json() as { cities: Cities };
    const part: Cities = {};
    const key = String(current.migrationBucket);
    for (const name in legacy.cities) if (bucket(name) === key) part[name] = legacy.cities[name];
    const path = `hotel-static/city-sync/${current.run}/${crypto.randomUUID()}-${key}.json`;
    await env.DOCUMENTS_R2.put(path, JSON.stringify(part));
    current.shards[key] = path;
    current.migrationBucket++;
    await checkpoint(current);
    return result();
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error("Checkpoint migration failed"), { syncPhase: "migration", pagesDone: current.pages });
    }
  }
  if (!current.exhausted) {
    const pageNumber = current.pages + 1;
    if (current.pages && !current.cursor) throw fail("SYNC_CHECKPOINT_INVALID", "The saved cursor is missing. Do not restart.", { syncPage: pageNumber, pagesDone: current.pages, syncPhase: "checkpoint" });
    let phase = "supplier";
    try {
      const page = await client.cityRegionIds(2000, current.cursor);
      if (!Array.isArray(page.hotelCityRegionIds) || typeof page.hasMore !== "boolean"
        || (page.hasMore && (!page.nextCursor || page.nextCursor === current.cursor || !page.hotelCityRegionIds.length))) {
        throw fail("CITY_PAGINATION_INVALID", "City pagination did not advance safely; saved progress was preserved.");
      }
      const cursorHash = page.nextCursor ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(page.nextCursor)))).map((n) => n.toString(16).padStart(2, "0")).join("") : null;
      if (page.hasMore && cursorHash && current.cursorTrail?.includes(cursorHash)) throw fail("CITY_PAGINATION_INVALID", "City pagination returned an earlier cursor; progress was preserved.");
      phase = "persistence";
      const updates: Record<string, { name: string; id: number; country: string }[]> = {};
      for (const row of page.hotelCityRegionIds) {
        const name = String(row.cityName ?? "").toUpperCase().trim();
        const id = Number(row.cityRegionId);
        if (!name || !Number.isSafeInteger(id) || id < 1) throw fail("CITY_PAGE_INVALID", "City page contains invalid region data.");
        (updates[bucket(name)] ??= []).push({ name, id, country: String(row.countryName ?? "").toUpperCase() });
      }
      const next = { ...current, shards: { ...current.shards } };
      for (const [key, rows] of Object.entries(updates)) {
        const obj = current.shards[key] ? await env.DOCUMENTS_R2.get(current.shards[key]) : null;
        if (current.shards[key] && !obj) throw fail("SYNC_SHARD_MISSING", "A saved city shard is missing. Do not restart.");
        const cities: Cities = obj ? await obj.json() as Cities : {};
        for (const row of rows) {
          if (!cities[row.name]) { cities[row.name] = []; next.cityCount++; }
          if (!cities[row.name].some(([id, country]) => id === row.id && country === row.country)) {
            cities[row.name].push([row.id, row.country]); next.count++;
          }
        }
        const path = `hotel-static/city-sync/${current.run}/${crypto.randomUUID()}-${key}.json`;
        await env.DOCUMENTS_R2.put(path, JSON.stringify(cities));
        next.shards[key] = path;
      }
      next.cursorTrail = cursorHash ? [...(current.cursorTrail ?? []), cursorHash] : current.cursorTrail;
      next.pages = pageNumber; next.cursor = page.nextCursor; next.exhausted = !page.hasMore;
      await checkpoint(next);
      Object.assign(current, next);
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error("City sync failed"), { syncPage: pageNumber, pagesDone: current.pages, syncPhase: phase });
    }
  }
  if (current.exhausted) {
    try {
      if (!current.cityCount) throw fail("CITY_INDEX_EMPTY", "The supplier returned no city data. The previous completed index is preserved.");
      current.builtAt = new Date().toISOString();
      const previous = await env.DOCUMENTS_R2.head(CITY_INDEX_KEY);
      const lease = await env.DOCUMENTS_R2.head(PROGRESS);
      if (lease?.etag !== etag) throw fail("SYNC_CONFLICT", "Sync progress changed before publication. Refresh status.");
      const published = await env.DOCUMENTS_R2.put(CITY_INDEX_KEY, JSON.stringify(current), {
        onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
        customMetadata: { builtAt: current.builtAt, count: String(current.cityCount) },
      });
      if (!published) throw fail("SYNC_CONFLICT", "Another sync published a city index. Refresh status.");
      current.complete = true;
      await checkpoint(current);
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error("City index publication failed"), { code: (err as { code?: string })?.code ?? "CITY_INDEX_PUBLISH_FAILED", syncPage: current.pages, pagesDone: current.pages, syncPhase: "publication" });
    }
  }
  return result();
}

export async function readCityMatches(env: Env, names: string[]): Promise<[number, string][]> {
  const obj = await env.DOCUMENTS_R2.get(CITY_INDEX_KEY) ?? await env.DOCUMENTS_R2.get(LEGACY_INDEX_KEY);
  if (!obj) throw fail("CITY_INDEX_MISSING", "The TripJack hotel city list has not been synced yet — run Admin → Integrations → Sync hotel cities");
  const index = await obj.json() as State | { cities: Cities };
  if (!("version" in index)) return names.flatMap((name) => index.cities[name] ?? []);
  const matches: [number, string][] = [];
  for (const key of new Set(names.map(bucket))) {
    if (!index.shards[key]) continue;
    const shard = await env.DOCUMENTS_R2.get(index.shards[key]);
    if (!shard) throw fail("SYNC_SHARD_MISSING", "The hotel city index is incomplete; contact support.");
    const cities = await shard.json() as Cities;
    for (const name of names) if (bucket(name) === key) matches.push(...(cities[name] ?? []));
  }
  return matches;
}
