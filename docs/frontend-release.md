# October 16 compatible frontend release

This release contains landscape/square/story cards with matching previews, native image-file sharing where supported, raster/maskable/iOS installation assets, explicit online guidance, a factual `#/partners` page and read-only `npm run release:preflight`.

The broader recovery/archive/API work remains on `codex/next-crew-release`. Owner Cloudflare authentication expired and could not refresh. This frontend subset deliberately retains the deployed API source/config/migrations and lockfile unchanged: content tag `crew-571550e9422d44df680672557ad708766a2cabe1`. No backend deployment, migration, capability change or production data write is part of this subset. The existing Pages matching-tag gate and rollback procedure remain intact.

## Local verification

- Formatting, lint, typecheck, production frontend/Worker dry-run builds passed.
- Frontend 107/107; existing Worker/D1 74/74; release-gate 20/20; Python integrity/operator 17/17 passed.
- Pinned Chromium, Firefox and WebKit passed desktop/mobile emulation against a fresh isolated Worker/D1. Synthetic write, correction, exact retry, response loss, keyboard, reduced-motion, routes and navigation tests remain in place. Additional checks compare all three PNG downloads byte-for-byte to their canvas previews and inspect installation icons/base paths. Chromium also checks 320px views.
- Maximum title/subtitle,25 names, Unicode/emoji and unbroken text rendered and visually inspected in all formats. [Old clipping](qa/next-release/card-baseline.png), [landscape](qa/next-release/card-landscape.png), [square](qa/next-release/card-square.png), [story](qa/next-release/card-story.png). All are synthetic data.
- File-sharing API selection and cancellation are unit-tested with browser API doubles; real OS share sheets and physical devices have not been tested.
- No service worker is installed. Opening, reading and saving requires a connection; local drafts remain and never submit automatically.

A review caught and fixed superseded public data escaping an in-flight image encode. An early browser check found an ambiguous format label; its accessible label was fixed and the complete suite rerun. Visual review also enlarged native selects to 44px and aligned phone guidance.

## Dependency review

The unchanged lockfile reports 10 development-tool package advisories (4 moderate, 6 high); `npm audit --omit=dev` reports 0. Affected paths are Vitest/mocker, Wrangler/Miniflare/sharp/undici and build-time helpers. No affected tool is added to the production bundle. Targeted tooling maintenance requires separate verification and a newly tagged Worker, because the root lockfile contributes to the API tag. No blind upgrade was performed.

## Hosted status

[PR #7](https://github.com/Arhaan2/million-beers-by-2035/pull/7) merged normally after exact-head [CI 38965804594](https://github.com/Arhaan2/million-beers-by-2035/actions/runs/38965804594) passed on `3f1479f5ae502019d780dc33827dacb9116d3f07`. Merge/main/deployed runtime: `860343848a1c0ce7c25017a77721158459604481`. [Pages 38966319339](https://github.com/Arhaan2/million-beers-by-2035/actions/runs/38966319339) completed both build and deployment successfully. Public `release.json` matches; all 13 published files match the exact Pages artifact's SHA-256 hashes.

Read-only public reconciliation preserved every one of the prior 378 entry hashes and 394 allocations at revision 441, total 1,472; no intervening entries appeared. There were no production writes. The Worker tag remains `crew-571550e9422d44df680672557ad708766a2cabe1`, schema 3; no migrations applied. Its current version UUID could not be read with expired owner authentication.

The full remaining implementation is preserved in [draft PR #8](https://github.com/Arhaan2/million-beers-by-2035/pull/8); it is not deployed. Its local integrated gate passes 153 frontend, 80 Worker/D1, 20 release and 17 Python tests plus six browser cases. See [the current checkpoint](next-release-plan.md) for the exact owner sign-in action and protected backend release sequence.

Live read-only verification passed all six Chromium/Firefox/WebKit desktop/mobile sessions against the deployed commit: eight public routes per session, three image formats, API-backed totals and partner metrics/contact, base-path assets, manifest/maskable/iOS icons, and honest online guidance. Zero console/page/network errors and zero attempted mutation requests. No credentials, form submissions or live screenshots were used. One initial verifier assumption about a names checkbox on a project card was corrected (project cards contain no names); the complete six-case run then passed. Physical devices remain untested.
