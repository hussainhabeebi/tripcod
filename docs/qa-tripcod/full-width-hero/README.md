# Full-width hero review

Supersedes the split hero layout in PR #2. All three existing WebP images cover the entire hero scene with crossfades, a dark readability gradient and overlay content. Charcoal #4B4D4F and amber #FFB005 remain the brand accents. Search stays immediately below, linked by the hero CTA.

Production Next build and TypeScript passed. Chromium checks against the local production build (external hosts blocked) passed at 320, 375, 390, 428, 768, 1024 and 1440px: all three active images decoded, covered the viewport width, no horizontal page overflow, indicator selection and previous/next wrap worked. Playback/pause, keyboard activation, synthetic swipe and search-anchor navigation passed. No browser runtime errors. Desktop and mobile screenshots accompany this report.

Autoplay defaults on with six-second rotation. Reduced-motion preference disables automatic startup and transitions; Play remains available. Focus, pointer entry and swipe pause playback. No booking/API/backend/deployment changes. Physical device and cross-browser QA are outside this check.
