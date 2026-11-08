// Airport lookup for the flight search boxes (public, no login, no tenant).
//
//   GET /api/airports/search?q=tbil&limit=10   → { airports: [...] }
//   GET /api/airports/TBS                      → { airport: {...} }
//
// Data source: the `airports` table in D1 (primary database, binding HOTEL_DB). If D1 is not bound
// or a query fails, the same list bundled into the Worker is used instead, so
// the search box keeps working (also before the D1 table has been seeded).

import { Hono } from "hono";
import type { Env, Variables } from "../types.js";
import bundled from "../data/airports.json";

export type AirportResult = { code: string; name: string; city: string; country: string; countryName: string };

type Row = [code: string, name: string, city: string, country: string, countryName: string, rank: number, keywords?: string];
const BUNDLED = bundled as Row[];

const toResult = (r: Row): AirportResult => ({ code: r[0], name: r[1], city: r[2], country: r[3], countryName: r[4] });

// Lower score sorts first. Mirrors the ORDER BY in the D1 query below.
function score(r: Row, q: string): number {
  const code = r[0].toLowerCase(), city = r[2].toLowerCase();
  if (code === q) return 0;
  if (city === q) return 1;
  if (city.startsWith(q)) return 2;
  if (r[4].toLowerCase() === q) return 3;
  if (q.length <= 3 && code.startsWith(q)) return 4;
  if (r[6]?.toLowerCase().includes(q)) return 5;
  if (r[1].toLowerCase().includes(q) || city.includes(q)) return 6;
  return 7;   // country-name prefix match
}

function searchBundled(q: string, limit: number): AirportResult[] {
  return BUNDLED
    .filter((r) =>
      r[0].toLowerCase().startsWith(q) || r[2].toLowerCase().includes(q) ||
      r[1].toLowerCase().includes(q) || r[4].toLowerCase().startsWith(q) ||
      !!r[6]?.toLowerCase().includes(q))
    .sort((a, b) => score(a, q) - score(b, q) || b[5] - a[5])
    .slice(0, limit)
    .map(toResult);
}

async function searchD1(db: D1Database, q: string, limit: number): Promise<AirportResult[]> {
  const { results } = await db.prepare(
    `SELECT code, name, city, country, country_name AS countryName
       FROM airports
      WHERE code LIKE ?2 OR city LIKE ?3 OR name LIKE ?3 OR country_name LIKE ?2 OR keywords LIKE ?3
      ORDER BY CASE
                 WHEN lower(code) = ?1 THEN 0
                 WHEN lower(city) = ?1 THEN 1
                 WHEN city LIKE ?2 THEN 2
                 WHEN lower(country_name) = ?1 THEN 3
                 WHEN length(?1) <= 3 AND code LIKE ?2 THEN 4
                 WHEN keywords LIKE ?3 THEN 5
                 WHEN name LIKE ?3 OR city LIKE ?3 THEN 6
                 ELSE 7
               END,
               rank DESC, city
      LIMIT ?4`,
  ).bind(q, `${q}%`, `%${q}%`, limit).all<AirportResult>();
  return results ?? [];
}

export const airportRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

airportRoutes.get("/search", async (c) => {
  // Keep letters (any script), digits, spaces, hyphens and apostrophes; drop LIKE wildcards.
  const q = (c.req.query("q") ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, "").trim().slice(0, 60);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 10, 1), 25);
  if (q.length < 2) return c.json({ airports: [] });

  let airports: AirportResult[] | null = null;
  if (c.env.HOTEL_DB) {
    try { airports = await searchD1(c.env.HOTEL_DB, q, limit); }
    catch (err) { console.error("[airports] D1 search failed, using bundled list", err); }
  }
  // An empty D1 result can mean the table has not been seeded yet.
  if (!airports?.length) airports = searchBundled(q, limit);

  c.header("Cache-Control", "public, max-age=3600, s-maxage=86400");
  return c.json({ airports });
});

airportRoutes.get("/:code{[A-Za-z]{3}}", async (c) => {
  const code = c.req.param("code").toUpperCase();
  let airport: AirportResult | null | undefined;
  if (c.env.HOTEL_DB) {
    try {
      airport = await c.env.HOTEL_DB.prepare(
        "SELECT code, name, city, country, country_name AS countryName FROM airports WHERE code = ?1",
      ).bind(code).first<AirportResult>();
    } catch (err) { console.error("[airports] D1 lookup failed, using bundled list", err); }
  }
  if (!airport) {
    const row = BUNDLED.find((r) => r[0] === code);
    airport = row ? toResult(row) : null;
  }
  if (!airport) return c.json({ error: "Airport not found" }, 404);
  c.header("Cache-Control", "public, max-age=86400");
  return c.json({ airport });
});
