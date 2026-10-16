# October 16 compatible frontend release

This release contains landscape/square/story cards with matching previews, native image-file sharing where supported, raster/maskable/iOS installation assets, explicit online guidance, a factual `#/partners` page and read-only `npm run release:preflight`.

The broader recovery/archive/API work remains on `codex/next-crew-release`. Owner Cloudflare authentication expired and could not refresh. This frontend subset deliberately retains the deployed API source/config/migrations and lockfile unchanged: content tag `crew-571550e9422d44df680672557ad708766a2cabe1`. No backend deployment, migration, capability change or production data write is part of this subset. The existing Pages matching-tag gate and rollback procedure remain intact.

## Local verification

- Formatting, lint, typecheck, production frontend/Worker dry-run builds passed.
- Frontend 106/106; existing Worker/D1 74/74; release-gate 20/20; Python integrity/operator 17/17 passed.
- Pinned Chromium, Firefox and WebKit passed desktop/mobile emulation against a fresh isolated Worker/D1. Synthetic write, correction, exact retry, response loss, keyboard, reduced-motion, routes and navigation tests remain in place. Additional checks compare all three PNG downloads byte-for-byte to their canvas previews and inspect installation icons/base paths. Chromium also checks 320px views.
- Maximum title/subtitle,25 names, Unicode/emoji and unbroken text rendered and visually inspected in all formats. [Old clipping](qa/next-release/card-baseline.png), [landscape](qa/next-release/card-landscape.png), [square](qa/next-release/card-square.png), [story](qa/next-release/card-story.png). All are synthetic data.
- File-sharing API selection and cancellation are unit-tested with browser API doubles; real OS share sheets and physical devices have not been tested.
- No service worker is installed. Opening, reading and saving requires a connection; local drafts remain and never submit automatically.

A review caught and fixed superseded public data escaping an in-flight image encode. An early browser check found an ambiguous format label; its accessible label was fixed and the complete suite rerun. Visual review also enlarged native selects to44px and aligned phone guidance.

## Dependency review

The unchanged lockfile reports10 development-tool package advisories (4moderate,6high); `npm audit --omit=dev` reports0. Affected paths are Vitest/mocker, Wrangler/Miniflare/sharp/undici and build-time helpers. No affected tool is added to the production bundle. Targeted tooling maintenance requires separate verification and a newly tagged Worker, because the root lockfile contributes to the API tag. No blind upgrade was performed.

## Hosted status

PR, hosted CI, merge and deployed commit evidence will be added after the normal process completes. This file does not itself claim deployment.
