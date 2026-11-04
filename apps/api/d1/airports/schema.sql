-- D1 (primary database) — world airport list used by the flight search boxes.
-- Idempotent; kept out of d1-migrations/ so it never shows up as a pending
-- migration in the guarded release. Data: apps/api/d1/airports/seed.sql.
CREATE TABLE IF NOT EXISTS airports (
  code         TEXT PRIMARY KEY NOT NULL,   -- IATA code, e.g. TBS
  name         TEXT NOT NULL,               -- Tbilisi International Airport
  city         TEXT NOT NULL,               -- Tbilisi
  country      TEXT NOT NULL,               -- ISO 3166-1 alpha-2, e.g. GE
  country_name TEXT NOT NULL,               -- Georgia
  lat          REAL,
  lon          REAL,
  rank         INTEGER NOT NULL DEFAULT 1,  -- 1 small … 4 large with scheduled service
  keywords     TEXT NOT NULL DEFAULT ''     -- alternative names (old names, local spellings)
);
CREATE INDEX IF NOT EXISTS airports_city_idx    ON airports (city COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS airports_country_idx ON airports (country);
