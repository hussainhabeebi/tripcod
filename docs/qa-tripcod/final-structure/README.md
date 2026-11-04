# Approved Tripcod homepage and navigation

Supersedes the earlier restoration-only proposal in docs/qa-tripcod/preservation. Implemented on the existing PR #5 branch, codex/remove-hero-play, from 3c7df50.

## Final homepage

Exactly seven direct sections, followed by the shared footer:

1. Existing full-width three-image hero (unchanged, no Play/Pause button).
2. Existing premium flight search (unchanged component and form behavior).
3. Already have a booking? / My Trips and guest booking lookup.
4. Explore flight routes (all six existing cards/search links).
5. Routes travellers are checking (all six existing photographic route cards).
6. Popular Destinations (unchanged component, data, prices and WhatsApp links).
7. Explore airline options (all eight directory entries).

No trust strip, benefit cards, testimonials, gallery, journey steps, support CTA or floating widget remains as an extra homepage section.

## Content placement and navigation

- **Home** → `/`: the seven sections above.
- **Flights** → `/#flight-search`: existing search and booking journey.
- **My Trips** → `/trips`: unchanged trip management; guest booking lookup remains `/trips/find`.
- **Services** → `/services`: all ten original services via the existing ServicesSection. Existing trust/booking benefits, premium confidence messages and booking steps are preserved here in BookingInformation rather than deleted.
- **About** → `/about-us`: existing About page preserved, with the original Our Journey preview and testimonials added; original gallery remains here. Mission/vision, values, statistics and contact CTA remain.
- **Support** → `/support`: original travel-assistant CTA, customer support section, floating WhatsApp, telephone/email contacts and trip lookup links.
- **Destinations** → `/destinations`: page and shared destination content unchanged; retained as a direct navigation item.
- **Hotels** remains available under More and in the mobile menu.
- Account and currency controls remain. Insurance and Wallet links are removed from header, mobile menu and footer navigation. Their routes, existing balances/operations and backend code are not deleted. Agent wallet/credit descriptions remain existing service copy, not navigation links.
- Footer retains its original agent CTA, branding, social/contact details and supporting content; Services and Support links added, About label aligned, Insurance/Wallet links removed.

The expanded desktop navigation switches to the existing menu pattern below 1280px to preserve tablet spacing. Header logo and all three hero assets are unchanged.

## Verification

- Optimized Next.js production build and TypeScript: **passed** (34 pages).
- UI/ranking/clock tests: **12/12 passed**.
- Local production Chromium: **70/70 scenario groups passed** at 320, 375, 390, 428, 768, 1024 and 1440px. This includes 42 existing search/results/filter/details/passenger/review/checkout/My Trips/roundtrip interactions and 28 Services/About/Support/Destinations checks.
- Exact seven-section homepage order asserted at every width; all three hero images selected/decoded. Services count = 10; About journey/gallery/testimonials visible; Support links visible. Mobile/tablet menu items checked, and Insurance/Wallet navigation links absent from header/footer.
- Zero horizontal page overflow, runtime errors or booking/payment submissions. External hosts/fonts blocked, fixture API isolated from suppliers. Native date entry/range behavior checked; native calendar grid/physical-device/cross-browser/live transaction behavior remains unverified.
- Source audit: protected application/package files outside the five intentionally changed presentation files match 3c7df50. Hero, Destinations, shared marketing data, booking, search requests, payment, supplier, authentication and ownership code remain unchanged. See source-preservation.json.
- Git whitespace checks passed. No new Lighthouse measurement or live supplier/payment claim.

Evidence: responsive.json (including exact homepage order for every width), source-preservation.json, screenshots/home-390.jpg and screenshots/home-1440.jpg. The screenshots load all local images before capture. Older preservation screenshots describe the previous proposal; these are the final structure.
