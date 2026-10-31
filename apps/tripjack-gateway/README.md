# Tripcod TripJack Gateway

Dedicated fixed-egress gateway for the TripJack API. Deploy this directory from
the `main` branch as a Coolify Dockerfile application.

## Required Coolify variables

- `TRIPCOD_GATEWAY_KEY` — independent random secret shared only with the Tripcod Worker
- `TRIPJACK_UPSTREAM` — `https://apitest.tripjack.com` for UAT (flights)

## Hotel API v3 hosts (optional — UAT defaults shown)

TripJack serves hotels from separate hosts. The gateway forwards `/hms/*`
(listing, pricing, review, static content, nationalities) and
`/oms/v3/hotel/*` (book, confirm, booking details, cancel, booking list):

- `TRIPJACK_HMS_UPSTREAM` — `https://apitest-hms.tripjack.com` (UAT) · `https://hms-search.tripjack.com` (production)
- `TRIPJACK_HOTEL_BOOKER_UPSTREAM` — `https://apitest-hotel-booker.tripjack.com` (UAT) · `https://hms-booker.tripjack.com` (production)

TripJack must whitelist the gateway IP for the hotel hosts too.

Hotels can use a different TripJack account (UAT / Production) than flights.
The Worker sends `X-Tripcod-Hotel-Environment: UAT|PRODUCTION` on hotel calls;
when present, hotel routes use that environment's TripJack hotel hosts
(overridable with `TRIPJACK_HMS_UPSTREAM_UAT`, `TRIPJACK_HOTEL_BOOKER_UPSTREAM_UAT`,
`TRIPJACK_HMS_UPSTREAM_PRODUCTION`, `TRIPJACK_HOTEL_BOOKER_UPSTREAM_PRODUCTION`).
Without the header, and for every flight, TripSafe and user route, routing is
unchanged. A gateway without this support ignores the header.

The Cloudflare Worker owns `TRIPJACK_API_KEY` and sends it to the gateway on
each authenticated request. It does not need to be stored in Coolify.
`TRIPJACK_API_KEY` remains supported in Coolify only as an optional fallback
for direct self-hosted callers.

Optional controls are documented in `src/gateway.mjs`. Configure port `3000`,
domain `proxy.tripcod.com`, and health path `/health` in Coolify.

TripJack must whitelist the public outbound IP of the Coolify host. The gateway
never returns either secret and logs no request or response bodies.
