# Databases: D1 primary, Neon secondary

Tripcod uses two databases:

| | Role | Binding / secret | Code |
|---|---|---|---|
| **Cloudflare D1** (`tripcod`) | **Primary.** New tables go here. | `DB` in `apps/api/wrangler.toml` | `@tripcod/db/d1` (`createD1Db`), SQL in `apps/api/d1/migrations` |
| **Neon Postgres** | **Secondary.** Holds the tables not yet moved to D1 (tenants, users, bookings, payments, wallets…). | `DATABASE_URL` secret | `@tripcod/db` (`createDb`), SQL in `packages/db/drizzle/migrations` |

## What lives in D1 today

- `airports` — the world airport list (≈5,400 airports with an IATA code and
  airline service, from OurAirports) used by the flight search boxes through
  `GET /api/airports/search?q=…` and `GET /api/airports/:code`.

The airport list is also bundled into the API Worker
(`apps/api/src/data/airports.json`), so search keeps working if D1 is
unavailable or not yet seeded.

## Setup

CI (`.github/workflows/deploy.yml`) does all of this on every push to `main`:
it creates the `tripcod` D1 database if it does not exist, writes its id into
`wrangler.toml`, applies migrations and loads the airport list when the table is
empty or the list changed. The `CLOUDFLARE_API_TOKEN` must have
**Account → D1 → Edit** permission.

By hand:

```bash
cd apps/api
npx wrangler d1 create tripcod            # once; paste database_id into wrangler.toml
pnpm d1:migrate                           # schema
pnpm d1:seed:airports                     # airport data
```

Local development: `pnpm d1:migrate:local && pnpm d1:seed:airports:local`.

## Refreshing the airport list

```bash
pnpm --filter @tripcod/db airports:build   # downloads OurAirports, rewrites seed SQL + bundled JSON
```

Commit the two generated files; the next deploy reloads D1. City names and
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
numbered SQL file under `apps/api/d1/migrations`, copy the data across, switch
the routes to `createD1Db(c.env.DB)`, and keep the Neon table read-only for one
release as the fallback before dropping it.
