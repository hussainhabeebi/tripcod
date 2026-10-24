# Homepage preservation review

Reference: `7ba97f0594d7c8285d198ca5c837ab3ce509e4d7`. Correction based on merged main `381afb1dd04fac82a8222fe2c8007617bbbbfce6`, on existing branch `codex/remove-hero-play`. Not merged or manually deployed.

## What happened

No non-hero website section or booking implementation was removed between the requested reference and the latest merged main. The post-reference application diff contains only HeroBanner.tsx and its hero styles: the split card became a full-width banner, captions moved into overlay content, a search CTA and default autoplay were added, and the Play/Pause control was removed at the owner's request. The decorative T / C badge was also removed as part of the hero layout; the actual Tripcod logos never changed.

The missing homepage content predates the reference. PR #1 replaced the original homepage at `0375431a5d716fdce44faf0b2ac1568a46422b33` with a shorter flight-first homepage. That removed more website content than the owner wanted. Restoring only the reference would retain those omissions, so this correction reuses the original homepage components and data while retaining the premium flight experience.

## Section inventory in display order

| Original section/widget | At 7ba97f0 / before this correction | After correction |
| --- | --- | --- |
| Hero | Split image card at reference; full-width on main | Full-width, all three images retained; no new hero change in this correction |
| Flight search | Premium search | Same component and wrapper, directly below hero |
| Booking trust strip | Missing | Restored in original position |
| Manage Booking strip | Replaced by premium My Trips/guest-booking section farther down | Premium section moved to original manage-strip position; both links retained |
| About / Our Journey | Missing | Original component, text, stats, photo and About link restored |
| Trusted Services | Missing | Original service cards restored |
| Popular Destinations | Missing | Original destination cards, values and WhatsApp booking links restored |
| Six fare/route cards | Missing | Routes, example values and search links restored; explicitly labelled illustrative |
| Popular Routes | Missing | Original six photographic route cards and search links restored |
| Airline directory | Missing | Original eight entries restored; directory wording, no partnership/live-availability claim |
| Four booking benefit cards | Missing | Original cards and text restored |
| Premium confidence messages | Present just after search | Retained alongside the restored benefit section |
| Testimonials | Missing | Original component and testimonials restored |
| Travel Moments gallery | Missing | Original images/captions restored |
| Four booking steps | Missing | Original Search / Compare / Confirm / Pay & fly steps restored |
| WhatsApp travel assistant CTA | Missing | Original CTA, text and link restored |
| Premium support section | Present | Retained after restored CTA; Support navigation anchor remains valid |
| Floating Need help / WhatsApp | Missing | Original link restored |
| Footer / agent CTA / contact / socials | Present | Unchanged, after homepage content |

Original restored sections retain their relative order. Existing premium My Trips functionality replaces the equivalent old strip at that strip's original position, avoiding duplicate booking controls. Scoped restoration styles reuse existing components without enabling obsolete `.home-phase1` rules that could change the current header or search.

Original static flight-fare examples are explicitly marked illustrative, not live quotes. The original unsupported 50+ airline/partner wording is represented by a directory with a current-availability explanation; all eight original entries remain. Destination values, company stats, testimonial copy and imagery are restored from the repository, not independently revalidated.

## Preserved navigation and functionality

Header and SiteNav are byte-for-byte identical to the reference: logo/home, Flights, My Trips, Support; More contains Hotels, Insurance, Wallet, Destinations and About Us; currency and Account remain. The mobile menu contains all those routes and account access. No links were removed; the existing More/menu hierarchy remains.

Footer is also identical: agent registration/login and perks, original light logo, brand copy, trust labels, social links, office/phone/email contacts, Book / Manage / Company / For agents columns, copyright, fare note and credits.

`source-preservation.json` verifies **390 application/package files identical to 7ba97f0**, excluding only homepage page.tsx, HeroBanner.tsx and flight-experience.css. This includes search/results/journey, passenger forms, checkout/payment logic, My Trips, authentication/account ownership, suppliers, APIs and assets (including all three hero images and actual logos). The correction itself modifies only page.tsx and scoped restoration CSS, plus this review evidence. No integration or business logic changed.

## Verification

- TypeScript: passed.
- Optimized Next.js production build: passed.
- UI/ranking/flight-clock tests: 12/12 passed.
- Chromium local production verification with isolated mocked API: **42/42 interaction groups passed** across 320, 375, 390, 428, 768, 1024 and 1440px, covering homepage/search, results/filter/details, passengers/review/sticky actions, token checkout/payment presentation, My Trips and return journey. Zero runtime errors, horizontal page overflow or booking/payment submissions. All three hero images selected and decoded at each width. `responsive.json` includes section, header and footer inventories at every width.
- Focused 390/1440px visual check: every local homepage image loaded; mobile menu / desktop More links visible; full-page and gallery screenshots captured with lazy images loaded. `visual.json` records the result.
- Git diff whitespace checks: passed.

Screenshots: [mobile homepage](screenshots/home-390.jpg), [desktop homepage](screenshots/home-1440.jpg), [mobile gallery](screenshots/gallery-390.jpg), [desktop gallery](screenshots/gallery-1440.jpg).

No live supplier, payment or authentication-enforcement transaction was attempted. Native calendar day-grid selection, physical devices and cross-browser/screen-reader behavior remain unverified as previously documented; native date entry/range checks passed. External hosts/fonts were blocked in the browser fixture. No new Lighthouse scores were measured. Existing booking baseline failures were not rerun because booking/API source files are identical; no new assertion about live booking readiness is made.
