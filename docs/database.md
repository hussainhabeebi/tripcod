# Databases: D1 primary, Neon secondary

Tripcod uses two databases:

| | Role | Binding / secret | Code |
|---|---|---|---|
| **Cloudflare D1** (`tripcod-hotels`) | **Primary.** New tables go here. | `HOTEL_DB` in `apps/api/wrangler.toml` | `@tripcod/db/d1` (`createD1Db`); hotel orders in `apps/api/d1-migrations`, airports in `apps/api/d1/airports` |
| **Neon Postgres** | **Secondary.** Holds the tables not yet moved to D1 (tenants, users, bookings, payments, wallets…). | `DATABASE_URL` secret | `@tripcod/db` (`createDb`), SQL in `packages/db/drizzle/migrations` |

## What lives in D1 today

- `hotel_bookings` — website hotel orders (schema in `apps/api/d1-migrations`,
  applied only by the guarded release workflow).
- `airports` — the world airport list (≈5,400 airports with an IATA code and
  airline service, from OurAirports) used by the flight search boxes through
  `GET /api/airports/search?q=…` and `GET /api/airports/:code`.

The airport list is also bundled into the API Worker
(`apps/api/src/data/airports.json`), so search keeps working if D1 is
unavailable or not yet seeded.

## Loading the airport table

The airport schema is idempotent SQL kept outside `d1-migrations/`, so it never
appears as a pending migration in the guarded release preflight. Run once
(and again after refreshing the list):

```bash
cd apps/api
pnpm d1:airports          # remote: creates the table if missing, then loads the list
pnpm d1:airports:local    # same, for wrangler dev
```

Until this has run, `/api/airports/*` serves the bundled copy, so nothing breaks.

## Refreshing the airport list

```bash
pnpm --filter @tripcod/db airports:build   # downloads OurAirports, rewrites seed SQL + bundled JSON
```

Commit the two generated files, then run `pnpm d1:airports` again. City names and
alternative spellings travellers use (Kozhikode/Calicut, Bengaluru/Bangalore…)
are set in `CITY_OVERRIDES` / `EXTRA_KEYWORDS` in
`packages/db/scripts/build-airports.mjs`.

## Moving more tables from Neon to D1

Planned order, one group per change so each can be verified on its own:

1. Read-mostly reference data: supplier config, markup rules, email logs, audit log.
2. Tenants and agents (cached in KV already, so low traffic to the database).
3. Users and sessions.
4. Bookings, payments and wallets — last, because they use Postgres features
   D1 does not have: interactive transactions (D1 offers `batch()` only),
   `numeric` money columns (store as integer minor units), enums (TEXT with a
   CHECK), `jsonb` (TEXT + `json_*` functions) and `FOR UPDATE` row locks.

For each group: add the SQLite schema to `packages/db/src/d1/schema.ts`, a
numbered SQL file under `apps/api/d1-migrations` (and allow it in the release preflight), copy the data across, switch
the routes to `createD1Db(c.env.HOTEL_DB)`, and keep the Neon table read-only for one
release as the fallback before dropping it.
