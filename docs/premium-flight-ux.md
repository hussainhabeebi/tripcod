# Tripcod flight UX implementation

Review branch: `codex/premium-flight-ux`  
Base: `0375431a5d716fdce44faf0b2ac1568a46422b33`  
Production deployment: **not performed**. No merge requested or performed.

## Audit

The existing pnpm workspace has Next.js 15 / React 18 customer, admin and agent apps, a Hono API, shared supplier adapters and database packages. Customer styling uses global CSS, inline checkout styles and CSS modules. Existing integrations include TripJack, Riya, Duffel and indicative Google SERP search, supplier review, passenger extras, Nomod/Razorpay configuration, wallet payments and authenticated/guest trip retrieval. These paths were retained, not replaced. This audit establishes source presence, not live supplier readiness.

The former homepage emphasized destinations and agency content, showed static fares under “live prices”, included unverified airline-partner claims, and sent the Flights navigation to a preset route. Airport suggestions lacked keyboard selection, editing could leave an old airport selected, round-trip cabin class was inaccessible and an accent token referenced itself.

## Completed UI

| Screen | Change |
| --- | --- |
| Home | Flight-first editorial layout, existing local wing photo, original logo, prominent search, concise benefits, My Trips/guest-booking access and WhatsApp assistance. Removed static flight prices, airline claims and distracting agency sections from home; secondary services remain reachable. |
| Shared navigation | Flights opens search, My Trips and Support are primary, remaining services in More/mobile menu; account and currency behavior retained. Skip-content link and visible focus states. |
| Search | Existing one-way/round-trip/multi-city routes and request keys retained. Keyboard combobox, Escape, clear buttons, empty suggestions, invalid/same-airport messages, accessible traveller controls, natural tab order, round-trip cabin selector. AI search retained in a disclosure. Existing native date inputs/range constraints retained. |
| Results | Branded summary/cards, full traveller count, explicit recommendation rule, arrival-time and currency-safe maximum-total filters. Existing departure/stops/airline/refund/baggage filters retained. Mobile filter sheet includes sorting, keyboard containment, Escape, focus restoration and scroll locking. Existing skeletons retained. |
| Details/fares | Segment timeline from returned segments, connection airport and next departure, baggage unknown-state text, partial refund label, existing supplier fare families and selection. Single-option TripJack fares can open existing fare-rules retrieval. No invented fare families/benefits. |
| Passenger/review | Shared four-step progress in regular and token checkout. Consistent focus/card/action treatment, existing edit/review state and entered data handling retained. No new persistence of passenger data. |
| Payment/status | Existing held-payment progress and branded payment-result panel. Gateway requests, payment polling, status decisions and redirects unchanged. |
| My Trips | Quieter branded header, cards and actions; existing upcoming/past/cancelled filters, authentication, ownership and document links retained. |

No API, supplier, database, deployment configuration, secret, pricing calculation, booking status transition or ownership code was modified. Recommendation scoring and result filters are presentation logic only. No booking/payment submission was performed during verification.

## Logo-derived color system

Pixel counts from both `tripcod-logo.webp` and `apps/web/public/logo.png` identify the dominant opaque flat fills below. Smaller neighboring colors are compression/edge variants, not additional brand colors. Logo files/proportions were preserved.

| Token | HEX | Use |
| --- | --- | --- |
| `--brand-primary` | `#4B4D4F` | Charcoal identity, selected tabs, assistance panel, results header |
| `--brand-secondary` / `--brand-accent` | `#FFB005` | Amber identity, main actions, active progress and decorative accents |
| `--background` | `#F7F7F3` | Complementary neutral page |
| `--surface` | `#FFFFFF` | Cards/forms |
| `--text-primary` | `#252729` | Dark text, including text on amber |
| `--text-secondary` | `#626568` | Secondary text |
| `--border` | `#DFE1DB` | Dividers and control boundaries |
| `--success` | `#176947` | Semantic success |
| `--warning` | `#815400` | Semantic warning and high-contrast focus |
| `--error` | `#B42318` | Semantic error |

Only charcoal and amber are extracted brand fills; other tokens are designed complementary/semantic colors. Amber is not used for small text on white.

Recommended ranking is 0.62 × normalized price + 0.28 × normalized duration + 0.1 × stop count. Lower is better; missing values receive a conservative component score and ties retain incoming order. Cheapest/fastest/departure ordering and all-fares access remain. Currency-safe maximum-total filtering is offered only when returned fares share a currency matching the requested display currency; stale filters are ignored on a currency change.

## Verification and limits

- Customer TypeScript: passed.
- Next.js production build: passed. Existing globals.css Autoprefixer warning about `end` remains.
- New UI/ranking tests: **9/9 passed**. Covers recommendation tradeoffs, missing data/ties, airport keyboard/clearing/stale values, round-trip cabin + request format, multi-city serialization, infant/adult limits, invalid route and filter reset/modal dismissal.
- Existing supplier review tests: **19/19 passed**.
- Booking-confirmation/reviewed-total subset: **20/24 passed**. Same four failures reproduced on untouched base in a separate worktree: explicit rejected booking, lost submit response, accepted booking/save failure and their parent test. Backend fixes are outside this UI task.
- Local HTTP smoke checks: `/`, `/trips`, `/pay`, `/checkout/payment-result`, `/search/journey` returned 200. Homepage rendered the new search heading without the old static deals. These checks do not execute browser JavaScript or verify responsive layout.
- Browser visual QA, screenshots and Lighthouse: **BLOCKED**. Playwright package is available but no browser binary is installed. Chromium download repeatedly returned invalid/truncated ZIP data. No viewport, accessibility-score or visual-pass claims are made for 320/375/390/428/768/1024/1440 widths. CSS includes responsive rules, but all requested viewports still require real-browser review.
- Screen-reader/native-calendar interaction, real gateway redirects and authenticated trip screens need browser/UAT verification. No live prices or bookings were fabricated for validation.

## Remaining integration/UI limits

- The normalized segment interface does not expose terminal fields; terminal information is not invented or added to adapters.
- No verified airline-logo assets are bundled for the results; existing airline-code marks are retained.
- Popularity/route metrics are not verified; no “popular” route claims or live homepage prices are shown.
- Native calendars remain the working date mechanism; a custom date-range calendar was not introduced without browser verification.
- The existing round-trip/multi-city journey screen keeps its selection behavior; shared branding/navigation apply, but it has not had a separate visual redesign verified in a browser.
- Confirmation/itinerary pages retain existing status logic and document eligibility. No new ticket-issuance guarantees are introduced.
- Publication requires a separate production approval. This is a draft for review, with visual QA and the pre-existing booking failures outstanding.

## Reproduce focused checks

From the repository root with installed workspace dependencies:

```sh
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node --test apps/web/test/flight-ranking.test.mjs
node --test packages/suppliers/test/tripjack-review.test.cjs
```

The ranking test uses Node 24 native TypeScript support. DOM tests use jsdom as a test-only external harness without adding runtime dependencies:

```sh
npm install --prefix /tmp/tripcod-qa jsdom --no-audit --no-fund --ignore-scripts
JSDOM_PATH=/tmp/tripcod-qa/node_modules/jsdom node --test apps/web/test/search-widget.test.cjs
```

Build from `apps/web` with `node node_modules/next/dist/bin/next build`. None of these commands deploy or migrate production resources.
