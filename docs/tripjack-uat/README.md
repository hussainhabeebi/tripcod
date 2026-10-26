# TripJack Flight UAT preparation

Prepared 2026-10-26 against integration baseline main `c757f8e5d3753f3c7497ee958b0bc029bf431df6`.
This comparison records the original baseline findings; see IMPLEMENTATION.md for corrections and current validation. This is preparation, not TripJack certification or approval. No supplier requests were made.
No production code, credentials, routing, database, deployment or booking state changed.

## Sources and scope

The supplied Air API PDF (revision history includes 2.0.2), Postman collection, and nested sample archives were inspected locally. See `sources.json` for exact source hashes. PDF page numbers below are physical pages, not text line numbers. Original documents and collections are not copied into git: they may contain credentials, personal information, expired IDs and historical dates. `search-contract-examples.json` contains only structural search metadata extracted from the supplied examples.

## Integration comparison

| Area | Evidence / current behavior | Assessment and certification action |
| --- | --- | --- |
| Hosts | PDF pp.10–12: apitest.tripjack.com for UAT, tripjack.com for production. Gateway main default is apitest. | Code default matches. Deployed TRIPJACK_UPSTREAM unverified. |
| Admin selection | apps/api/src/routes/admin/integrations.ts saves uat.tripjack.com / api.tripjack.com; Admin page repeats them. | Both differ from Flight docs. Prepare separate correction; do not change live production settings here. Worker URL can override saved URL. |
| Authentication | PDF introduction: apikey header shared throughout flow. Client applies one key to FMS and OMS; gateway forwards incoming header or uses fallback. | Contract matches; actual winning key unverified. Admin, tenant, Worker and gateway values must be traced without exposing keys. |
| Search | POST /fms/v1/air-search-all; gateway alias /air-search-all/v2 maps correctly. | Matches path/method. |
| Cabin | PDF p.18 and supplied Business/Premium Economy samples use ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST. Client uses cabinClass.charAt(0). | Confirmed mismatch across all four classes. Correct before first meaningful search. |
| Journeys | One-way 1 leg, return 2 legs, multicity 2–6 ordered legs. Client searchLegs builds these shapes. Adapter expands totalPriceList and ONWARD/RETURN/COMBO/indexed keys. | Basic payload shape tested offline; live availability, pairing and all leg selection still need UAT. |
| Search modifiers | PDF p.19 describes direct-only true/connecting false, connecting-only inverse, both omitted or both true. Client always sends isDirectFlight:false. | Does not express the documented unrestricted choice. Verify desired frontend filtering versus supplier filters; preferredAirline and special-return sample behavior also need coverage. |
| Review | POST /fms/v1/review with priceIds; client requires bookingId and handles supplier errors. | Matches basic contract. Validate priceIds selected across all journey types, conditions, alerts and session expiry. |
| Fare rules | /fms/v2/farerule supported; client always sends flowType SEARCH. Postman also includes review/revalidate and post-booking contexts. | SEARCH supported; other contexts need scope confirmation and tests before claiming support. Legacy v1 need not be implemented merely because collection contains it. |
| Instant fare validation | PDF and supplied fare-validate-v2 archive document /oms/v1/air/book/fare-validate. Gateway maps it. | No dedicated client call or identified application flow wiring. client.validateFare actually calls review, not this endpoint. |
| Held fare validation | /oms/v1/air/fare-validate before confirm-book. Gateway maps it. | No dedicated client method; inspected held-confirm queue path goes directly to confirmHold. Flow requires correction/review. |
| OMS isolation | Client optionally uses omsBaseUrl for /oms/ independently of baseUrl. | Search reaching staging does not prove booking reaches staging. Validate all effective URLs and egress before any OMS test. |
| Instant / hold payload | Supplied samples use paymentInfos for instant and omit it for hold. Client implements this distinction, passenger types, GST, passport, SSR and emergency fields. | Basic shape matches in mock test; field completeness must follow live review conditions. Never reuse sample names/IDs for certification. |
| Order state | PDF distinguishes ON_HOLD from SUCCESS (PNR/ticket completion). Adapter.book can map ON_HOLD or top-level status.success to CONFIRMED. | High-priority semantic risk: HTTP/API success is not ticket issuance. Test PENDING/ON_HOLD/FAILED/SUCCESS across route, queue and polling before certification; no fix made. |
| SSR | Pre-booking SSR is available through review + travellerInfo; seat route mapped. Client post-booking ssrList/addSsr use /oms/v1/air/ssr-list and /oms/v1/air/ssr. | These paths are absent from gateway and differ from supplied collection's /fms/v1/ancillaries/fetch/seat, /fms/v1/ancillaries/fetch/ssr and /oms/v1/air/amendment/add/ssr. Treat post-booking SSR as unverified/unsupported until reconciled. |
| Amendments / extras | Basic cancellation charges, submission, details, hold/release are mapped. Collection also has reissue, user-detail and ancillary services not covered by current flight route map/client. | Agree implemented certification scope with TripJack. Do not claim every collection request is supported or required. |
| Evidence exporter | certification.ts has correct documented host names and per-step files; it rewrites logged URLs according to selected environment. Client recorder captures raw headers/body. | Exported URL is not proof of actual upstream environment. Never publish raw logs: they can contain API/gateway keys and passenger data. Retain upstream-host evidence separately. Verify fallback gateway key evidence if Worker supplied no apikey. |

## Documentation questions for TripJack

1. Certification table pp.130–132 contains ten- and twelve-passenger cases; p.127 error 1006 says maximum nine. Keep original case counts and ask which limit applies. Do not bypass application validation or silently reduce passengers.
2. Student/senior is marked optional in the certification overview, but listed without that qualifier in Going Live Steps (p.133). Confirm whether required for this account.
3. Going Live Steps says both to submit request/response JSON and “Clients should not send their logs.” Confirm intended packaging and secure submission channel for unmodified originals and key. Do not send secrets through chat or public issues.
4. Confirm whether instant fare validation, held fare validation, post-booking SSR, reissue and user-detail are required for agreed enabled scope. Historical Postman paths/examples are not live certification evidence.

## Execution gates — all unresolved until administrator evidence is supplied

- Dedicated UAT Worker/gateway/tenant/settings/storage with no production queues, payment callbacks or production customer routing. Existing wrangler production config and shared preview KV do not establish isolation.
- Effective Admin/tenant/Worker/gateway credential precedence recorded by source name only. Newly generated staging key assigned in the isolated resource's secure secret interface; no shared Hotels/TripSafe or production replacement.
- Worker FMS and OMS base URLs and gateway actual upstream pinned to staging. No redirects or fallback to production. Same staging key for both services.
- Actual outbound IPv4 measured inside each serving gateway container; compare with whitelisted 156.67.110.188 and verify stable NAT/egress. Status remains UNVERIFIED. A DNS A record is insufficient.
- Authorized hosting terminal/operator access is required to identify the deployed container, inspect non-secret routing configuration, and measure egress. No such access is available in this session.
- Cabin mismatch resolved and offline contracts passing before meaningful first search. No automatic retries or batch supplier execution.

## Phased UAT runbook

### A. Offline (authorized now)

Run from repository root:

```sh
node --test packages/suppliers/test/tripjack-uat-contract.test.cjs
node --test apps/tripjack-gateway/test/gateway.test.mjs packages/suppliers/test/tripjack-review.test.cjs
```

The new tests replace global fetch for every client call, including synthetic booking payload checks. They contain no live runner or secrets. Six known contract gaps are TODO assertions with failure evidence; a zero process exit code does not mean those assertions passed.

### B. First live search only (not executed)

After every execution gate passes, use the existing conditional authorization for exactly one read-only staging Flight Search. Choose DEL–BOM, 1 adult, one-way ECONOMY, future date agreed by operator. Route through the verified UAT gateway, with the key resolved securely. Stop after one response; no retries, review, booking or payments. Record UTC time, request ID, actual upstream hostname, HTTP status, supplier status.success/errors[].errCode and sanitized message, result count and journey keys. HTTP 200 with status.success:false is a failure; an empty successful result is connectivity evidence but not certification coverage. Do not persist response bodies containing secrets or personal data in git/chat.

### C. Read-only flow qualification (separate scope authorization before running)

Cover all four cabins; direct/connecting/unrestricted; domestic/international one-way, return and 2–6-leg multicity. Refresh all old sample dates. Assert real selected price IDs, fare totals for every passenger, availability and currencies. Review only fresh selected fares and verify bookingId, session timeout, conditions, fare alerts, GST/passport/DOB/document/emergency requirements. Test fare rules and seat maps only when applicable. Validate stale fare, no availability, auth failure, rate limit, timeout and malformed response using mocks first; do not deliberately probe bad credentials live.

### D. Booking certification (NOT AUTHORIZED / NOT RUN)

`certification-cases.json` preserves all 22 table rows with unique IDs (the PDF repeats serial number 7). Eight rows exceed nine passengers and are explicitly blocked for clarification. Dates, multicity sectors and permitted passenger identities must be agreed before execution. Each applicable case must include Search → Review → documented applicable fare validation → Book → Booking Details, plus fare rule/seat/SSR/hold confirmation/release where used. Never run a Postman collection wholesale: it includes bookings, cancellation, void and reissue actions.

Overlay the matrix with published fares domestic/international, special return, passport, with/without GST, baggage/meal SSR, and student/senior when required. Add hold→validate→confirm and hold→release only after explicit authorization. These are real state-changing supplier operations even on staging; isolate payment handling and use only agreed UAT wallet arrangements.

Assertions: exact reviewed supplier amount (separate markup), fare/SSR change acknowledgement, correct passenger and segment SSR keys, complete conditional fields, hold is not ticketed, pending is not success, final SUCCESS has expected PNR/tickets, retries/duplicate clicks do not create duplicate orders, and session expiry fails safely. Test customer ownership and cross-tenant isolation locally before live work. Capture amendment/void/reissue only if in agreed scope and separately authorized.

## Evidence and acceptance

For each case retain separate original request/response files for every implemented service, confirmation numbers, statuses, timestamps, correlation IDs, source revision, actual upstream host and verified egress evidence. Keep originals in access-controlled UAT storage. Produce a separate redacted review copy; never alter originals and call them raw. Submit API key or passenger details only through a TripJack-approved secure channel after confirming requirements. certification.ts's environment-selected URL rewrite must be identified as reconstruction, not observed network evidence.

No case is certified merely by an exporter listing required files. TripJack must review the agreed cases and issue sign-off before production enablement.

## Measured offline results

2026-10-26: new contract suite reports 12 tests: 6 pass (including parent), 0 unexpected failures, 6 TODO assertions currently fail as expected (four cabin values, missing fare-validation methods, unmatched SSR path). Five behavioral subcases passed. Existing gateway/review regression suites: 28 tests passed, 0 failed. No build/typecheck was run because changes contain only documentation, JSON metadata and JavaScript tests; production TypeScript is unchanged. No live search, booking, supplier call, deploy, merge or credential change occurred.
