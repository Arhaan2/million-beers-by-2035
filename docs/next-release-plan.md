# Next crew release — execution checkpoint

## Scope and invariants

Implement the October 16 release brief: reliable resource refresh and edit recovery; contextual recording and local group preferences; discoverable recaps and complete public exports; resilient share cards; installation assets with honest online requirements; factual partnerships; read-only preflight; verified normal release. Preserve the amber/cream design, shared-code/public-reading model, append-only ledger, correction limits, historical Crew Size and privacy projections. No new paid services, photos, identity platform, analytics, messages or production synthetic entries.

## Verified starting point — October 16, 2026

- Clean workspace on main; fetched origin/main is `bce5fe6ff68820ba6266cca6148ca95e268521c3`. No open PRs. Branch: `codex/next-crew-release`.
- Last hosted build and Pages deployment: [38461511710](https://github.com/Arhaan2/million-beers-by-2035/actions/runs/38461511710), successful. Public release.json matches main.
- Live health/readiness successful. Worker tag `crew-571550e9422d44df680672557ad708766a2cabe1`, schema 3, revision 441. All existing crew capabilities enabled; photos and strong identity disabled.
- Read-only public baseline: 1,472 total; 378 entries; 394 allocations; 37 historical named contributor records; 37 public named contributors; 7 recent active participants. These are observed data, not synthetic fixtures or audience metrics.
- Configuration unchanged: target 1,000,000; start July 24, 2026; deadline January 1, 2035; America/Los_Angeles calendar.
- Baseline frontend 101/101, Worker/D1 74/74, release-gate 20/20 and Python 17/17 passed. The initial sandbox-only localhost restriction was resolved with permitted execution; it was not an application failure.

## Decisions and dependencies

1. Lightweight resource revisions and explicit request sequencing; keep unsaved editors mounted.
2. Metadata/member uncertain outcomes reconcile server state before deliberate retry; ledger retries retain exact durable payload/key.
3. Add a generous hashed-network mutation ceiling alongside existing session ceiling; accepted exact retries bypass mutation budgets.
4. Reuse schema/revision tables. No migration currently expected. Full selected archive must abort if server revision changes, including privacy edits; never label partial exports complete.
5. Share cards use a single bounded text layout for landscape, square and story; no QR dependency. Names default off.
6. Ship raster/maskable/iOS installation assets and an explicit online requirement. No service worker/API cache: avoids stale privacy projections and incompatible cached shell without adding maintenance.
7. Backend content tag must match before merge/frontend deploy. Protected backup, restored-copy rehearsal and per-ID integrity checks still required even without migrations.

## Phase status

| Phase                         | Status                                           | Evidence / next step                                                                                                                         |
| ----------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 baseline                    | Complete                                         | Current source/live baseline; A–F reproduced with synthetic tests/pixels                                                                     |
| 1 recovery and bounded writes | Implemented and verified                         | Mounted refresh, deliberate edit recovery, stale-read/privacy protection, session + hashed-network limits; pending compatible Worker release |
| 2 contextual recording        | Implemented and verified                         | Durable attempt precedence, people-only shortcuts, inline saved groups, explicit default/reset and actual-entry receipts                     |
| 3 discovery and export        | Implemented and verified                         | Accessible periods, actual months, consistent public filters/metrics; complete 50-record batches, revision guards, cancel and safe CSV/JSON  |
| 4 sharing                     | Implemented and verified                         | Three bounded formats, preview/pixels, native file support and fallback; compatible portion shipped in PR #7                                 |
| 5 phone access                | Implemented and verified, deliberately narrower  | Complete install assets and online guidance; no service worker/cache                                                                         |
| 6 partnerships                | Implemented and verified                         | Timestamped ledger metrics, proposed collaborations and existing contact; compatible portion shipped in PR #7                                |
| 7 preflight                   | Complete                                         | Read-only source/tag/readiness/capability/frontend checks; remote migration status explicitly unavailable                                    |
| 8 release                     | Compatible subset deployed; full release blocked | PR #7 is live; full PR #8 is draft until backup/rehearsal/tagged Worker gates become possible                                                |

## Operational evidence and blockers

Private exports, restored databases, configuration inventories and live captures stay outside Git. The compatible frontend subset is deployed; no Worker deployment, production data mutation or migration occurred. Expired Cloudflare authorization blocks the remaining release. See current evidence below; the initial baseline is historical.

## Follow-ons only

Revocable editor invitations; approved photo storage/privacy; justified dynamic social previews; a separate generalized product only if explicitly chosen. None implemented in this run.

## Implementation checkpoint — October 16, 2026

- Baseline complete: frontend 101, API 74, release-gate 20, Python 17 all passed. Initial release-gate failures were only sandbox `listen EPERM`; the same tests passed with permitted localhost execution.
- Findings A/B reproduced against original source in synthetic regression tests: correction detail stayed stale, and member creation 401 did not request reauthentication. C confirmed generic ledger timeout copy on reads; method-aware handling implemented. D reproduced in exported pixels (unbroken titles exceeded the old card width); baseline and corrected three-format images are in `docs/qa/next-release/`. E/F reproduced in Worker tests: re-login reset effective write budgets; recap filtered rows disagreed with totals. Fixed API suite: 80/80 passed.
- Commits: `c01787e` baseline; `9fb194b` sharing/install/partnership components and pixels; `cbfa10b` preflight; `b9da954` browser visual/asset checks; `db7615d` bounded writes and consistent archive contracts. Recording/archive UI integration completed in `2004f9b`, `6cced69` and `f45a31f`.
- Independent review caught an excessive member-search limit and stale public projections in editor/receipt/error state. Fixes and regressions passed the final full gate.
- No migration, challenge/config change, capability toggle, dependency change or production write is required by the implementation.

## External blocker and compatible release split

Existing Cloudflare authorization is expired and cannot refresh in noninteractive mode. `wrangler whoami` reports that owner login is required. Consequently the actual migration inventory, protected production export, private restore/rehearsal and Worker deployment cannot run. No Worker deployment, private backup/restore, migration or private D1 reconciliation is claimed.

The user explicitly authorized a coherent compatible frontend subset when backend access is blocked. An isolated `codex/share-phone-partners` worktree retains the deployed API source and lockfile byte-for-byte (tag `crew-571550e9422d44df680672557ad708766a2cabe1`). It contains sharing, home-screen assets/online guidance, factual partnerships and read-only preflight. That subset passed all local and hosted release gates and is deployed through the normal PR/Pages process. Backend-dependent recovery/archive/rate-limit changes remain on `codex/next-crew-release` in reviewed draft PR #8; they will not merge before the new Worker is ready.

Dependency review: the locked install reports 10 development-tool advisories (4 moderate, 6 high); `npm audit --omit=dev` reports 0. Affected paths are Vitest/mocker, Wrangler/Miniflare/sharp/undici and build-time string/source-map helpers. No such package is added to production runtime. Existing local tests use isolated synthetic data; no public dev/test server is published. Keep the lockfile unchanged for the compatible release; any targeted toolchain update must be separately verified and followed by a newly tagged Worker, since the root lockfile contributes to that tag. No blind major update was performed.

## Frozen full runtime candidate and verification

Original frozen runtime: `f45a31f9f7dfe5e7246c1141d684a7bceefd3c75`. Integrated current runtime: `9afe24c1a71e86a57d6a6a79f1e5d6dd3a3a74e1` (includes main `8603438`). API tag: `crew-909dca06de20cc29976ddc806839dc06027210a8`. The deployed backend still has the earlier tag; never merge this full runtime until the required backend matches.

Final local gate passed both before and after main integration: format, lint, typecheck, frontend 153/153, real Worker/D1 80/80, release-gate 20/20, Python 17/17, Worker dry-run/frontend build and all six pinned Chromium/Firefox/WebKit desktop/mobile cases. Browser evidence is `docs/qa/next-release/full-browser-report.json`. Physical devices, real OS sharing and hosted rollback were not exercised. Final independent review found no remaining actionable issues after reproducing and fixing stale metadata/receipt/pagination projections and in-flight image races.

The archive has no arbitrary total-record ceiling. Each request is bounded to 50; traversal finishes only after exhausting cursors and passing a final same-revision read. Concurrent inserts, metadata or privacy changes abort rather than produce a mixed file. Cancellation produces no completed file; public exports include signed allocation amounts, source allocation/correction links, date basis and stable IDs. No browser archive cache is kept.

Interaction comparison (steps, not measured timings): single entry previously required Record → directory/search/select → quantity → save; from member detail it now needs Record for this member → quantity → save. A group previously required Record → split → select each person → quantities → review → confirm; a saved entry now supplies Use these people → quantities → review → confirm. Login remains necessary when the editor session is absent; unresolved durable submissions always win over shortcuts.

Remaining operator action: sign in using the existing Wrangler release profile. Then re-read remote configuration and migration inventory, make a fresh protected D1 export/bookmark, restore and verify per-ID hashes privately, rehearse existing/new clients and privacy-aware correction rollback, deploy the exact reviewed tagged Worker with preserved vars/secrets, verify readiness, merge through normal CI and verify Pages. None of those blocked backend operations has been performed. The public read-only snapshot reconciles 378 entries/394 allocations/total 1,472 at revision 441, but is not a substitute for private D1 integrity evidence.

## Published compatible release — October 16, 2026

- [PR #7](https://github.com/Arhaan2/million-beers-by-2035/pull/7) merged normally after [exact-head CI 38965804594](https://github.com/Arhaan2/million-beers-by-2035/actions/runs/38965804594) succeeded on `3f1479f5ae502019d780dc33827dacb9116d3f07`. No protection or readiness bypass.
- Runtime merge commit and published `release.json`: `860343848a1c0ce7c25017a77721158459604481`. [Pages run 38966319339](https://github.com/Arhaan2/million-beers-by-2035/actions/runs/38966319339) completed **both build and deploy successfully**. All 13 files in its downloaded Pages artifact matched live SHA-256 bytes.
- Live: [project](https://arhaan2.github.io/million-beers-by-2035/), [partnerships](https://arhaan2.github.io/million-beers-by-2035/#/partners).
- Public immutable-record verification before/after release preserved all 378 entry hashes and 394 allocations, total 1,472, revision 441. No intervening public entries appeared. This covers public data only; private D1 verification remains blocked and is required before the Worker release.
- Worker tag remains `crew-571550e9422d44df680672557ad708766a2cabe1`, schema 3; no migrations applied. Current Worker version UUID was not independently read because Cloudflare authorization is expired.
- Full [draft PR #8](https://github.com/Arhaan2/million-beers-by-2035/pull/8) preserves the remaining work. Hosted status is reported on that PR. Its frontend cannot deploy against the currently published Worker; the matching-tag gate correctly rejects it.
- [Documentation-only PR #9](https://github.com/Arhaan2/million-beers-by-2035/pull/9) passed [CI 38966896410](https://github.com/Arhaan2/million-beers-by-2035/actions/runs/38966896410) and merged as current `origin/main` `82220d83edf782502525eeee3b3467e166ca4fe2`. The actual deployed runtime remains `860343848a1c0ce7c25017a77721158459604481`; documentation-only commits are excluded by the Pages push path filter.

Smallest owner action after reviewing this checkpoint: run `npx wrangler auth create million-beers-release` in the project directory, complete Cloudflare sign-in, and resume this chat. Do not share tokens or crew codes. All remaining backup/rehearsal/deployment steps are already authorized; reauthentication is the missing external prerequisite. This exact command was verified against the installed CLI: `auth create` reauthenticates a named profile; plain `login` targets the default profile. A final `whoami` recheck still reports expired authorization.

Live read-only verification passed all six Chromium/Firefox/WebKit desktop/mobile sessions against the deployed commit: eight public routes per session, three image formats, API-backed totals and partner metrics/contact, base-path assets, manifest/maskable/iOS icons, and honest online guidance. Zero console/page/network errors and zero attempted mutation requests. No credentials, form submissions or live screenshots were used. One initial verifier assumption about a names checkbox on a project card was corrected (project cards contain no names); the complete six-case run then passed. Physical devices remain untested.

The first full-candidate hosted run [38966729879](https://github.com/Arhaan2/million-beers-by-2035/actions/runs/38966729879) failed in Linux WebKit because an expected aborted recap GET used the diagnostic `Load request cancelled`. The harness now recognizes that exact string and restricts all cancellation exceptions to exact known messages on local API GETs. It still fails genuine connection errors, timeouts, mutations, asset/external failures and failed UI assertions. Independent classification review passed 14 cases; all six local browsers passed again. The final exact-head hosted result is recorded on PR #8 and must pass before resuming release.
