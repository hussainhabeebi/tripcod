import { scanLegacyCities, CITY_SHARD_MAX_BYTES } from "./hotel-city-legacy.js";
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
  const legacy = old ? await scanLegacyCities(old, () => {}) : null;
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
  let lastCheckpointWrite = object?.uploaded?.getTime() ?? 0;
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
    const legacy = snapshot ? await scanLegacyCities(snapshot, () => {}) : null;
    if (legacy && (!Number.isSafeInteger(legacy.pages) || legacy.pages! < 0 || !Number.isSafeInteger(legacy.count) || legacy.count! < 0 || (legacy.cursor !== undefined && typeof legacy.cursor !== "string"))) throw fail("SYNC_CHECKPOINT_INVALID", "Invalid saved checkpoint metadata. Do not restart.");
    if (legacy && (legacy.pages || legacy.count || legacy.cityCount) && !legacy.cursor) throw fail("SYNC_CHECKPOINT_INVALID", "The saved cursor is missing. Preserve the checkpoint and inspect logs; do not restart.");
    if (restart && legacy?.pages) throw fail("SYNC_RESTART_BLOCKED", "Existing city pages are saved. Use Continue sync.");
    state = { version: 2, run, pages: legacy?.pages ?? 0, count: legacy?.count ?? 0,
      cityCount: legacy ? legacy.cityCount : 0, cursor: legacy?.cursor, shards: {},
      migrationBucket: legacy ? 0 : BUCKETS, ...(legacy ? { legacySource: source } : {}) };
    await checkpoint(state);
    initializedLegacy = !!legacy;
  }
  const current = state;
  async function checkpoint(next: State) {
    // R2 permits one write/second to a key. Initialization/terminal publication
    // can checkpoint twice in one invocation; Admin pacing alone cannot cover it.
    const delay = 1000 - (Date.now() - lastCheckpointWrite);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const saved = await env.DOCUMENTS_R2.put(PROGRESS, JSON.stringify(next), {
      onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
    });
    if (!saved) throw fail("SYNC_CONFLICT", "Another administrator advanced the sync. Refresh status and continue.");
    etag = saved.etag;
    lastCheckpointWrite = Date.now();
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
    const part: Cities = Object.create(null);
    const key = String(current.migrationBucket);
    let bytes = 2;
    await scanLegacyCities(old, (name, rows) => {
      if (bucket(name) !== key) return;
      bytes += new TextEncoder().encode(JSON.stringify(name) + ":" + JSON.stringify(rows)).length + 1;
      if (bytes > CITY_SHARD_MAX_BYTES) throw fail("CITY_SHARD_LIMIT", "Saved city shard exceeds the safe size. Original checkpoint retained; do not restart.");
      part[name] = rows;
    });
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
        if (obj && obj.size > CITY_SHARD_MAX_BYTES) { await obj.body.cancel(); throw fail("CITY_SHARD_LIMIT", "Saved city shard exceeds the safe size. Do not restart."); }
        const cities: Cities = obj ? await obj.json() as Cities : Object.create(null);
        for (const row of rows) {
          if (!cities[row.name]) { cities[row.name] = []; next.cityCount++; }
          if (!cities[row.name].some(([id, country]) => id === row.id && country === row.country)) {
            cities[row.name].push([row.id, row.country]); next.count++;
          }
        }
        const path = `hotel-static/city-sync/${current.run}/${crypto.randomUUID()}-${key}.json`;
        const serialized = JSON.stringify(cities);
        if (new TextEncoder().encode(serialized).length > CITY_SHARD_MAX_BYTES) throw fail("CITY_SHARD_LIMIT", "City shard reached the safe size limit; checkpoint retained.");
        await env.DOCUMENTS_R2.put(path, serialized);
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

// Completed catalogues remain preferred. A committed partial catalogue is usable
// for missing completed matches; it does not claim unsynced cities are absent.
export async function readCityMatches(env: Env, names: string[]): Promise<[number, string][]> {
  const completed = await env.DOCUMENTS_R2.get(CITY_INDEX_KEY);
  if (completed) {
    const matches = await readShards(env, await completed.json() as State, names);
    if (matches.length) return matches;
  }
  const legacy = !completed ? await env.DOCUMENTS_R2.get(LEGACY_INDEX_KEY) : null;
  if (legacy) {
    const matches = await readLegacy(legacy, names);
    if (matches.length) return matches;
  }
  const progress = await env.DOCUMENTS_R2.get(PROGRESS);
  if (progress) {
    const state = await progress.json() as State;
    // Until all buckets are migrated the immutable source contains every saved city.
    if (state.migrationBucket < BUCKETS && state.legacySource) {
      const source = await env.DOCUMENTS_R2.get(state.legacySource);
      if (!source) throw fail("SYNC_CHECKPOINT_MISSING", "The saved city snapshot is missing; do not restart.");
      return readAvailableLegacy(source, names);
    }
    const matches = await readShards(env, state, names);
    if (matches.length) return matches;
    throw fail("CITY_NOT_SYNCED", "This city is not in the saved hotel catalogue yet. Continue city sync in Admin.");
  }
  const partial = await env.DOCUMENTS_R2.get(LEGACY_PARTIAL);
  if (partial) return readAvailableLegacy(partial, names);
  if (completed || legacy) return [];
  throw fail("CITY_INDEX_MISSING", "The TripJack hotel city list has not been synced yet — run Admin → Integrations → Sync hotel cities");
}
async function readAvailableLegacy(object: { body: ReadableStream<Uint8Array> }, names: string[]) {
  const matches = await readLegacy(object, names);
  if (!matches.length) throw fail("CITY_NOT_SYNCED", "This city is not in the saved hotel catalogue yet. Continue city sync in Admin.");
  return matches;
}
async function readLegacy(object: { body: ReadableStream<Uint8Array> }, names: string[]): Promise<[number, string][]> {
  const selected = new Set(names), byName = new Map<string, [number, string][]>();
  let bytes = 0;
  await scanLegacyCities(object, (name, rows) => {
    if (!selected.has(name)) return;
    bytes += new TextEncoder().encode(JSON.stringify(rows)).length;
    if (bytes > CITY_SHARD_MAX_BYTES) throw fail("CITY_SHARD_LIMIT", "Requested city mappings exceed the safe size limit.");
    byName.set(name, rows);
  });
  return names.flatMap((name) => byName.get(name) ?? []);
}
async function readShards(env: Env, index: State, names: string[]): Promise<[number, string][]> {
  const matches: [number, string][] = [];
  for (const key of new Set(names.map(bucket))) {
    if (!index.shards[key]) continue;
    const shard = await env.DOCUMENTS_R2.get(index.shards[key]);
    if (!shard) throw fail("SYNC_SHARD_MISSING", "The hotel city index is incomplete; contact support.");
    if (shard.size > CITY_SHARD_MAX_BYTES) { await shard.body.cancel(); throw fail("CITY_SHARD_LIMIT", "Hotel city shard exceeds the safe size limit."); }
    const cities = await shard.json() as Cities;
    for (const name of names) if (bucket(name) === key) matches.push(...(cities[name] ?? []));
  }
  return matches;
}
