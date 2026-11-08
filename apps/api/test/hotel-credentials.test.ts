import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { hotelRoutes } from "../src/routes/hotel.js";
import { integrationsAdminRoutes } from "../src/routes/admin/integrations.js";
import { resolveHotelCredentials } from "../src/lib/hotels.js";

// Flights on the TripJack Production account, hotels on the separate UAT account.
const FLIGHT_PROD_KEY = "flight-production-key-0000000000000000000000";
const HOTEL_UAT_KEY = "hotel-uat-key-000000000000000000000000000";

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string, t?: string) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
    put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); }, m };
}
const SETTING = "admin_settings:t1:integration:tripjack";

function harness(saved: Record<string, unknown> | null, extraEnv: Record<string, string> = {}) {
  const TENANT = kv();
  if (saved) TENANT.m.set(SETTING, JSON.stringify(saved));
  const FARE = kv();
  FARE.m.set("hotel_v3:nationalities", JSON.stringify({ IN: "106" }));
  const env: any = { TENANT_CACHE_KV: TENANT, FARE_CACHE_KV: FARE, SESSIONS_KV: kv(),
    TRIPJACK_API_BASE_URL: "https://gw.example", TRIPJACK_PROXY_KEY: "P", TRIPJACK_API_KEY: "worker-flight-secret", ...extraEnv,
    DOCUMENTS_R2: { put: async () => {}, get: async () => null } };
  const app = new Hono<any>();
  app.use("*", async (c, next) => {
    c.set("tenantId", "t1"); c.set("tenant", { slug: "tripcod" });
    c.set("db", { insert: () => ({ values: async () => {} }) }); await next();
  });
  app.route("/api/hotels", hotelRoutes);
  app.route("/api/admin/integrations", integrationsAdminRoutes);
  const ctx: any = { waitUntil: () => {}, passThroughOnException: () => {} };
  const call = (path: string, body?: unknown) => app.fetch(new Request(`https://api.x${path}`, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, ctx);
  return { env, TENANT, call };
}

const SEARCH = { hids: ["100000038374"], checkIn: "2026-11-05", checkOut: "2026-11-20", rooms: [{ adults: 1 }], nationality: "IN", currency: "INR" };

function mockTripjack() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, headers: init.headers });
    const body = url.endsWith("/hms/v3/hotel/listing")
      ? { hotels: [{ hotelId: "100000038374", name: "Doha Bay", options: [{ optionId: "o1", roomInfo: [{ id: "r", name: "King" }], inclusions: [], mealBasis: "RO",
          pricing: { totalPrice: 9000, basePrice: 8000, discount: 0, taxes: 1000, mf: 0, mft: 0, currency: "INR" },
          commercial: { type: "NET", commission: 0 }, compliance: { gstType: "", panRequired: false, passportRequired: false },
          cancellation: { isRefundable: true, penalties: [] } }] }] }
      : { hotels: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
  return calls;
}

test("hotel credentials are resolved independently of the flight key", () => {
  const env = { TRIPJACK_API_KEY: "worker-flight-secret" } as any;
  // Flights Production + hotel UAT key saved → hotel UAT key on UAT.
  assert.deepEqual(resolveHotelCredentials({ apiKey: FLIGHT_PROD_KEY, environment: "PRODUCTION", hotelApiKey: HOTEL_UAT_KEY }, env),
    { environment: "UAT", apiKey: HOTEL_UAT_KEY, source: "admin-hotel-key" });
  // Flights Production, no hotel key → never the Production flight key on the UAT hotel hosts.
  assert.deepEqual(resolveHotelCredentials({ apiKey: FLIGHT_PROD_KEY, environment: "PRODUCTION" }, env),
    { environment: "UAT", apiKey: "", source: "none" });
  // Worker hotel secret fills in when Admin has no hotel key.
  assert.deepEqual(resolveHotelCredentials({ apiKey: FLIGHT_PROD_KEY, environment: "PRODUCTION" }, { ...env, TRIPJACK_HOTEL_API_KEY: "hs" }),
    { environment: "UAT", apiKey: "hs", source: "worker-hotel-secret" });
  // Previous setup (everything on UAT, one key) is unchanged.
  assert.deepEqual(resolveHotelCredentials({ apiKey: "uat-shared", environment: "UAT" }, env),
    { environment: "UAT", apiKey: "uat-shared", source: "flight-key" });
  assert.deepEqual(resolveHotelCredentials(null, env), { environment: "UAT", apiKey: "worker-flight-secret", source: "flight-key" });
  // Both on Production with one key keeps working too.
  assert.deepEqual(resolveHotelCredentials({ apiKey: FLIGHT_PROD_KEY, environment: "PRODUCTION", hotelEnvironment: "PRODUCTION" }, env),
    { environment: "PRODUCTION", apiKey: FLIGHT_PROD_KEY, source: "flight-key" });
});

test("hotel search sends the hotel UAT key and names UAT; the flight Production key is untouched", async () => {
  const { call, TENANT } = harness({ enabled: true, apiKey: FLIGHT_PROD_KEY, environment: "PRODUCTION", baseUrl: "https://api.tripjack.com", hotelApiKey: HOTEL_UAT_KEY });
  const calls = mockTripjack();
  const res = await call("/api/hotels/search", SEARCH);
  const body: any = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.hotels.length, 1);
  assert.ok(calls.length >= 1);
  for (const c of calls) {
    assert.ok(c.url.startsWith("https://gw.example/hms/v3/"), c.url);
    assert.equal(c.headers.apikey, HOTEL_UAT_KEY);
    assert.equal(c.headers["X-Tripcod-Hotel-Environment"], "UAT");
    assert.equal(c.headers["X-Tripcod-Gateway-Key"], "P");
  }
  const saved = JSON.parse(TENANT.m.get(SETTING)!);
  assert.equal(saved.apiKey, FLIGHT_PROD_KEY);
  assert.equal(saved.environment, "PRODUCTION");
});

test("without a hotel key, search stops before calling TripJack with a clear message", async () => {
  const { call } = harness({ enabled: true, apiKey: FLIGHT_PROD_KEY, environment: "PRODUCTION" });
  const calls = mockTripjack();
  const res = await call("/api/hotels/search", SEARCH);
  const body: any = await res.json();
  assert.equal(calls.length, 0, "no request may reach the gateway (its fallback key must not be used)");
  assert.equal(body.errorCode, "NOT_CONFIGURED");
  assert.match(body.error, /hotel UAT API key is not set/);
});

test("Admin saves the hotel key and environment without changing the flight key, and keeps them on a flight-only save", async () => {
  const { call, TENANT } = harness({ enabled: true, apiKey: FLIGHT_PROD_KEY, environment: "PRODUCTION", baseUrl: "https://api.tripjack.com",
    tripsafeEnabled: true, tripsafePayUserId: "614507" });
  let res = await call("/api/admin/integrations/tripjack", { enabled: true, environment: "PRODUCTION", tripsafeEnabled: true, hotelApiKey: HOTEL_UAT_KEY, hotelEnvironment: "UAT" });
  assert.equal(res.status, 200);
  let saved = JSON.parse(TENANT.m.get(SETTING)!);
  assert.equal(saved.apiKey, FLIGHT_PROD_KEY);
  assert.equal(saved.environment, "PRODUCTION");
  assert.equal(saved.baseUrl, "https://api.tripjack.com");
  assert.equal(saved.hotelApiKey, HOTEL_UAT_KEY);
  assert.equal(saved.hotelEnvironment, "UAT");
  assert.equal(saved.tripsafePayUserId, "614507");

  // An older Admin build (no hotel fields) must not wipe the hotel settings.
  res = await call("/api/admin/integrations/tripjack", { enabled: true, environment: "PRODUCTION", tripsafeEnabled: true });
  assert.equal(res.status, 200);
  saved = JSON.parse(TENANT.m.get(SETTING)!);
  assert.equal(saved.hotelApiKey, HOTEL_UAT_KEY);
  assert.equal(saved.hotelEnvironment, "UAT");
  assert.equal(saved.apiKey, FLIGHT_PROD_KEY);

  const view: any = await (await call("/api/admin/integrations/tripjack")).json();
  assert.equal(view.environment, "PRODUCTION");
  assert.equal(view.hotelEnvironment, "UAT");
  assert.equal(view.hotelKeySource, "admin-hotel-key");
  assert.ok(!JSON.stringify(view).includes(HOTEL_UAT_KEY) && !JSON.stringify(view).includes(FLIGHT_PROD_KEY), "keys are masked");
});
