# Supplied hero images

The homepage now uses the three supplied images in upload order: sunset wing, airport sunset, global connections. Optimized WebP assets total approximately 407 KiB. Existing headline, logo and flight search remain in place. Images are also visible on mobile.

Browser verification: Chromium, local isolated Next development server, external hosts blocked, reduced-motion enabled. All three slides decoded at 320, 375, 390, 428, 768, 1024 and 1440px. No horizontal page overflow or browser runtime errors. Previous/next wrap and direct dot selection passed at every width; opt-in six-second playback and pause passed. Six desktop/mobile screenshots accompany this report. Automated rotation starts only when requested with Play; focus, pointer entry and swipe stop rotation.

TypeScript and optimized production build passed. No API, booking, payment, supplier or deployment logic changed. Live production deployment is outside this local visual check.
