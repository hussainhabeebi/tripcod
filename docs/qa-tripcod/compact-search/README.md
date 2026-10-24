# Compact flight search and inline AI

Reference: 58000f955e08b553642ad3cdb20ca05b9704f2a9. Existing branch: codex/remove-hero-play.

## Changes

- Reduce only the homepage flight-search panel's padding, title spacing, control gaps, input heights and secondary spacing. Preserve charcoal #4B4D4F and amber #FFB005; keep the Search live flights action prominent.
- Trip types, travellers and currency stay in the first control row. From/swap/to, departure, return (when applicable) and cabin class occupy the main desktop field row. Filters and the search action align below.
- Round-trip class selection moved from the filters row into the main row without changing its value handling. Narrow screens wrap fields; dates/classes stack at 320px to keep native date text readable. Main mobile targets remain at least 44px and inputs 48px.
- Replace the old native details presentation with an accessible button and animated inline prompt immediately below it. Default collapsed; button toggles; Escape collapses and restores focus. Collapse retains the draft/result. Reduced-motion settings disable the transition. There is exactly one AI prompt.
- The reference already mounted AI within the panel, but its large tinted card looked separate. The compact inline layout removes that visual separation; no second homepage AI section was added or retained.
- Keep the existing AI parser endpoint, request body/headers, multilingual text handling, field application, preferences, manual validation, loading, error and partial-result behavior. Add explicit loading/unavailable feedback instead of an empty expanded area when the existing AI status flag is off. No backend parsing changed.

## Measured collapsed panel height

Local Chromium, same widths and blocked external fonts for before/after. Panel height includes heading, collapsed AI toggle, controls, fields, search action and benefit line.

| Width | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| 320 | 855.8px | 811px | 5.2% |
| 375 | 756.8px | 657px | 13.2% |
| 390 | 756.8px | 657px | 13.2% |
| 428 | 756.8px | 657px | 13.2% |
| 768 | 635.8px | 505px | 20.6% |
| 1024 | 456px | 338px | 25.9% |
| 1440 | 456px | 338px | 25.9% |

The desktop target is met. Mobile reduction is deliberately smaller to preserve 44px touch targets and readable native dates, including full-width date/class controls at 320px.

## Verification

- TypeScript and final optimized production build: passed (34 pages).
- 16/16 UI/ranking/clock tests passed, including four new tests for inline toggling/draft retention/Escape, forwarding all four supported languages and preserving parsed request preferences, partial/server/network errors and manual fallback, and AI-disabled feedback. Existing normal round-trip and multi-city request-format tests passed.
- Production Chromium at 320, 375, 390, 428, 768, 1024 and 1440px: AI opens immediately below its toggle inside the panel; English/Malayalam/Hindi/Arabic input is sent unchanged to mocked AI; parsed values fill the form; AI Search now and ordinary manually entered search both navigate correctly. Collapse/reopen retains draft; no horizontal overflow or runtime errors. Seven homepage sections remain at every width. Partial, server/network and disabled-status feedback verified.
- Seven existing homepage interaction groups also passed on the final build: keyboard airport autocomplete, swap, return-date range validation, cabin selection, infant/adult constraints and mobile navigation. The test-only selector was updated to target the outer navigation summary after the previously approved nested More menu; no header implementation changed.
- Round-trip date fields verified at least 130px wide at every width; invalid return dates rejected; class selection remained usable. Additional screenshots at 390/1024px show the round-trip layout.
- Source audit verifies **392 application/package files unchanged** outside SearchWidget.tsx, AiTripSearch.tsx, flight-experience.css and the UI test file. The homepage composition, hero, header, footer, Services/About, Destinations, APIs, supplier/booking/payment/auth/database code and assets are untouched. SearchWidget.applyAi, SearchWidget.handleSearch and AiTripSearch.submit are byte-identical to the reference; see source-preservation.json.
- No booking/payment submission or live supplier/AI call. AI responses are safe fixtures: this verifies frontend integration and multilingual forwarding, not live-model interpretation. Native calendar day-grid selection, physical devices, cross-browser and screen-reader behavior remain unverified; native input entry/range checks passed.

Evidence: browser.json, ordinary/responsive.json, source-preservation.json, height-comparison.json and before/after height JSON files.

## Screenshots

| State | Desktop | Mobile |
| --- | --- | --- |
| Before, collapsed | [1440px](before-1440.jpg) | [390px](before-390.jpg) |
| After, collapsed | [1440px](after-1440.jpg) | [390px](after-390.jpg) |
| Before, AI expanded | [1440px](before-ai-1440.jpg) | [390px](before-ai-390.jpg) |
| After, AI expanded | [1440px](after-ai-1440.jpg) | [390px](after-ai-390.jpg) |

Round trip after: [1024px](after-round-1024.jpg), [390px](after-round-390.jpg).
