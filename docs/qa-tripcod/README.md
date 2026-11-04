# Tripcod PR #1 — final UX verification

Review date: 23 October 2026. Branch: `codex/premium-flight-ux`. Starting commit: `24c9038ca7152732036b5663b12d574b8a75d751`.

**Customer UX checks completed in local Chromium. PR remains Draft. No merge, production deployment, supplier booking or payment submission occurred.** This report is not supplier UAT certification.

## Browser environment and safety

The original Playwright browser download was unavailable. A packaged `@sparticuz/chromium` 153.0.0 binary was extracted with Brotli and `tar --no-same-owner`, avoiding the container's unsupported ownership changes. Chromium 153.0.8010.0 ran with standard headless flags through Playwright. No production configuration or app runtime dependencies were changed.

Tests used an optimized Next.js production build configured **locally only** with `NEXT_PUBLIC_API_URL=http://127.0.0.1:4788`. The standalone mock server has no supplier credentials or upstream forwarding. The browser blocked external hosts. All names, tokens, fares, passport fields and trip records in screenshots are synthetic fixtures. Token-checkout passenger saves went only to the mock server. Booking and payment submission endpoints were never invoked. Do not deploy this locally generated QA bundle; a future release must build with its approved production configuration.

## Responsive and functional checks

Each cell represents a completed browser scenario, including layout measurement and the interactions described below. Viewport height was 900px; widths were CSS pixels, using a desktop Chromium engine with viewport emulation, not physical phones.

| Width | Home/search | Results/details/filters | Passenger/review/sticky action | Token checkout/payment step | My Trips | Return itinerary |
| --- | --- | --- | --- | --- | --- | --- |
| 320 | PASS | PASS | PASS | PASS | PASS | PASS |
| 375 | PASS | PASS | PASS | PASS | PASS | PASS |
| 390 | PASS | PASS | PASS | PASS | PASS | PASS |
| 428 | PASS | PASS | PASS | PASS | PASS | PASS |
| 768 | PASS | PASS | PASS | PASS | PASS | PASS |
| 1024 | PASS | PASS | PASS | PASS | PASS | PASS |
| 1440 | PASS | PASS | PASS | PASS | PASS | PASS |

- **42/42 interaction groups passed.** No measured page/element overflow or page JavaScript/hydration errors remained. A focused 320px recheck confirmed the final checkbox flex-shrink correction.
- Airport suggestions were selected with keyboard controls; swapping updated both airport values.
- **Native calendar day-grid selection is NOT VERIFIED:** the packaged headless browser opens the popup header but its screenshot has a blank day grid, including after a paint delay. This is a remaining browser-widget verification blocker; the Home/search PASS cells do not certify that native grid. Chromium's native departure-calendar entry point was clicked; dates were entered and invalid return-before-departure validity was checked. Round-trip cabin selection and infant/adult limits were exercised.
- Mobile navigation opened and reached My Trips at widths below 1024px.
- Result details expanded into the supplier segment timeline. Fare expansion, radio selection and the resulting fare-specific booking URL were checked.
- Desktop filters updated the result URL and reduced cards from two to one; Reset restored the URL and both cards. Mobile filter changes were staged, then applied with Show flights. Escape dismissed the sheet; keyboard focus stayed in the sheet and wrapped at its boundaries.
- Passenger entry reached review and returned to editing without losing the entered first name. Sticky booking controls stayed within the viewport and at its bottom.
- Token checkout reached review, required passport confirmation and reached the configured payment-method UI. **Pay now was not clicked.**
- Upcoming/cancelled My Trips filters displayed the corresponding fixture records. Return-journey selection revealed the Continue action; no booking was submitted.

Machine-readable evidence: [responsive.json](responsive.json), [checkbox recheck](checkbox-recheck.json), [regression invariants](regression.json).

## Corrections made during review

1. Replaced interrupted client-router result transitions with normal server-page navigation. Mobile filter changes are batched until Show flights, and closing the sheet discards the draft. This fixes the reproduced stuck Updating flights state; supplier request bodies remain unchanged. Desktop filter changes now perform a full page navigation.
2. Preserved the supplier's airport-local clock values in result cards, segment details, departure/arrival filter hours and passenger summaries. Offsets previously shifted the display into the server timezone. Local dates and multi-day arrival offsets are preserved. No fare or booking calculation changed.
3. Combined adjacent checkout CSS text blocks into one style string, removing a reproduced hydration mismatch.
4. Improved result/footer/payment metadata contrast; corrected the traveller selector's accessible name to match its visible text; added the passenger-page heading.
5. Enlarged fare-rule/radio/checkbox targets, prevented checkbox shrinkage at 320px, wrapped My Trips filters and corrected the sticky action selector so it no longer recolors the currency pills.
6. Added intrinsic logo dimensions to reserve space. Original image files and logo proportions remain unchanged. Charcoal `#4B4D4F` and amber `#FFB005` remain the identity colors; semantic and neutral colors provide readable contrast.

The existing restrained typography, card hierarchy, whitespace, native inputs and reduced-motion rules were retained. No redesign or additional animation dependency was introduced.

## Technical and booking regression results

| Check | Result |
| --- | --- |
| Clean Next.js production build, including type validity | PASS |
| Customer TypeScript check | PASS |
| UI/ranking/clock tests | 12/12 PASS |
| Existing supplier review tests | 19/19 PASS |
| Request/payment/auth source invariants | 13/13 PASS |
| Booking-confirmation + reviewed-total subset on branch | 20/24; four reported failures |
| Same subset on untouched `0375431` | Identical 20/24 and failure names/assertions |
| Backend/supplier/database/middleware/deployment files | Unchanged |

The invariant check compares actual function bodies for search requests, book links, currency conversion, booking submission/review/hold/wallet operations and gateway initiation. Authentication helper and FX files are unchanged. The payment component differs only in text-color literals. See `apps/web/test/browser/invariants.cjs`.

The four booking failures comprise **three failing assertions plus their parent test**, rather than four independent defects:

| Failing check | Identical baseline/branch result | Investigation |
| --- | --- | --- |
| Explicit rejected booking | `true` instead of `false` | Existing normalization does not use legacy `bookingStatus: FAILED` when the legacy success flag is true. |
| Lost submission response | `FARE_REVIEW_FAILED` instead of `BOOKING_STATUS_UNKNOWN` | Existing test mock omits the authoritative reviewed total; review rejects it before the intended submission scenario. |
| Accepted booking/local save failure | HTTP 503 instead of 202 | The same incomplete review fixture prevents reaching the intended save-failure scenario. |
| Parent confirmation-route test | Fails because of the two subtests | Counted separately by the Node test runner. |

No backend business logic or backend tests were modified. These failures still need separate booking-workstream review before a live booking-readiness claim.

## Measured Lighthouse results

Lighthouse **13.5.0**, mobile default emulation and simulated throttling, local production build, one final run per screen after a clean build. Chromium 153.0.8010.0. Supplier responses were local mocks; external Google Fonts were blocked, so system fallback fonts were measured. These are measured local QA results, not live-site scores or real-user performance measurements.

| Screen | Performance | Accessibility | Best practices |
| --- | --- | --- | --- |
| Homepage | 93 | 100 | 100 |
| Flight results | 97 | 100 | 100 |
| Token checkout, passenger step | 91 | 100 | 100 |

Evidence and remaining performance audit findings: [lighthouse.json](lighthouse.json). Automated accessibility scores do not establish full WCAG conformance. Payment-step interaction was browser-tested but was not a separate Lighthouse navigation.

## Screenshots — synthetic QA data

| Screen | Desktop | Mobile |
| --- | --- | --- |
| Homepage | [1440px](screenshots/home-1440.jpg) | [390px](screenshots/home-390.jpg) |
| Results | [1440px](screenshots/results-1440.jpg) | [390px](screenshots/results-390.jpg) |
| Passenger form | [1440px](screenshots/passengers-1440.jpg) | [390px](screenshots/passengers-390.jpg) |
| Token checkout | [1440px](screenshots/checkout-1440.jpg) | [390px](screenshots/checkout-390.jpg) |
| My Trips | [1440px](screenshots/trips-1440.jpg) | [390px](screenshots/trips-390.jpg) |

Additional mobile views: [calendar](screenshots/calendar-390.jpg), [filter sheet](screenshots/filters-390.jpg), [booking review](screenshots/booking-review-390.jpg), [payment step](screenshots/payment-390.jpg).

## Remaining limits

- Native calendar day-grid selection remains blocked by the headless popup rendering described above. Physical iOS/Android devices, Safari/WebKit, Firefox, real screen-reader operation and OS-specific calendar behavior were not tested.
- Real supplier latency/fare changes, gateway redirects, ticket issuance and live authentication/ownership enforcement were not exercised. Existing protections were preserved and source-checked; synthetic UI fixtures do not prove those integrations.
- Provider terminal fields and verified airline-logo assets remain unavailable in the existing normalized interface/assets.
- External font/CDN behavior was deliberately excluded. Local Lighthouse scores vary with environment and do not prove production Core Web Vitals.
- Four baseline booking-test failures remain as explained above. PR #1 remains Draft; no production action is authorized by this report.

## Reproduce

Use Node 24 and installed workspace dependencies. Install test tools outside the app:

```sh
npm install --prefix /tmp/tripcod-browser @sparticuz/chromium@153.0.0 lighthouse@13.5.0 jsdom@30.1.3 --ignore-scripts --no-audit --no-fund
node apps/web/test/browser/setup.cjs
JSDOM_PATH=/tmp/tripcod-browser/node_modules/jsdom node --test apps/web/test/search-widget.test.cjs apps/web/test/flight-ranking.test.mjs apps/web/test/flight-clock.test.mjs
node apps/web/test/browser/invariants.cjs
NEXT_PUBLIC_API_URL=http://127.0.0.1:4788 node apps/web/node_modules/next/dist/bin/next build apps/web
node apps/web/test/browser/review.cjs
node apps/web/test/browser/lighthouse.cjs
```

The harness expects Playwright through `CODEX_PRIMARY_RUNTIME_NODE_MODULES`; the browser review runner also accepts `PLAYWRIGHT_PATH`. Run the browser and Lighthouse harnesses sequentially because both use isolated local ports 4788/4789. Fixtures are not imported by the production app. No build/deployment configuration was changed.
