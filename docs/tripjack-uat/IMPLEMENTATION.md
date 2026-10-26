# UAT corrections prepared for review

Branch: codex/tripjack-uat-corrections. Base: c757f8e. No deploy/merge/live supplier requests.

## Changes

- Admin UAT saves apitest.tripjack.com and guidance names it. Production branch remains api.tripjack.com deliberately: changing production routing is outside this task. The official production hostname discrepancy remains a separate release decision.
- Four full cabin enums replace single-letter serialization, with legacy E/P/B/F accepted internally. Customer UI unchanged.
- Dedicated instant fare validation and held fare validation methods use the supplied OMS endpoints. Client book validates the exact assembled passenger/GST/SSR/contact/payment payload before instant booking; confirmHold validates the held booking before payment confirmation. Rejection, missing success, alerts or changed total stop the operation. Known direct production OMS targets are rejected when UAT validation is enabled.
- New validation calls activate for credentials uatFareValidation:true or direct apitest base. Worker flight credential resolution sets the flag only for ENVIRONMENT=staging. Production ENVIRONMENT=production retains its previous request sequence. No runtime configuration or key was changed. The gateway's actual upstream still must be verified independently; this flag cannot establish isolation.
- Post-booking SSR list and seat fetch use /fms/v1/ancillaries/fetch/ssr and /fms/v1/ancillaries/fetch/seat; additions use /oms/v1/air/amendment/add/ssr. Gateway permits all three.
- POST /api/booking/:id/ssr now accepts the documented paymentInfos + sI[].bI.tI[] structure, including supplier segment IDs, traveller IDs and codes. Invalid legacy index payloads fail schema validation before supplier submission. No in-repository web caller used the old ssrDetails contract. External consumers must migrate before enabling this operation; no guessed IDs or amounts are generated. Supplier validates the quoted amount; this change does not introduce a new customer payment flow.
- Shared TripJack booking normalization distinguishes accepted/PENDING, HELD, CONFIRMED and TICKETED. ON_HOLD never becomes confirmed even with a PNR or stale ticket fields. Ticketed requires explicit SUCCESS plus PNR and every returned traveller ticketed. Explicit order failure wins over API acceptance. Adapter, direct API and legacy booking route use consistent semantics.
- Queue stores held/pending states, checks supplier order status when polling, and suppresses ticket documents/confirmation notifications until ticket issuance. Pending/held results do not trigger confirmation rewards or settlement; existing confirmed-booking rewards and payment recording remain in place. Admin refresh cannot promote a held order to ticketed. No automatic rebooking or refund behavior was added.
- Checkout displays a held-state explanation. No search UI, Hotels or TripSafe logic was changed.

## Clarification

All 22 cases and original counts are unchanged. Eight total-passenger counts exceed nine and remain flagged. TRIPJACK-CLARIFICATION.md is a draft only; it was not sent.

## Validation

- Supplier + gateway + UAT contract suite: 50/50 tests passed, zero TODO/skips. All HTTP calls intercepted with synthetic data.
- Full API suite: 96 tests, 93 pass, 3 reported failures (two failing children plus their parent).
- Baseline booking suite: 11 tests, 7 pass, 4 reported failures. This change fixes the explicit-rejected-booking failure. The other two failing children are unchanged: lost-submit expects BOOKING_STATUS_UNKNOWN but receives FARE_REVIEW_FAILED; save-failure expects 202 but receives 503. Their review fixtures omit the supplier total and do not reach submission in the current payment-first flow. No production business logic was weakened to satisfy these stale fixtures.
- API and DB TypeScript checks passed; web/admin/portal TypeScript checks and Next builds passed. API build is its tsc --noEmit check. Final verification is recorded in the draft PR.
- Standard pnpm wrapper attempted automatic dependency preparation and was blocked by its ignored-build-script policy. Validation used already installed binaries directly; no dependency policy or lockfile change is included.

## Release / UAT blockers

Keep draft and unmerged. Confirm isolated staging Worker, storage, tenant settings, queues and payment callbacks; actual winning staging credential source; both FMS/OMS gateway upstreams; stable gateway outbound IPv4 matching 156.67.110.188; and secure key assignment. Hostname defaults alone prove none of these. No secure hosting access is available here.

TripJack must clarify passenger-limit cases and required enabled service scope. First read-only search remains unexecuted; booking certification is not authorized. Production validation-call activation requires its own review. The two existing booking fixture failures remain a test-maintenance blocker before a clean full API suite. Pending supplier orders still require status reconciliation; this patch does not add a new scheduler or payment-recovery workflow.
