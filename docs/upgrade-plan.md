# Crew upgrade execution record

This is an additive upgrade of the existing Million Beer Project. Production data preservation takes precedence over release completion. Private exports, account identifiers, row manifests, and live screenshots belong outside this repository.

## Baseline

- Source and remote main: `ab746e2aabec8774cf5f025ab466c68bf31377d8`; clean working tree on arrival.
- Work branch: `codex/million-beers-crew-upgrade`.
- Unique recovery tag: `rollback/million-beers-pre-crew-20260909-2334` (never move it).
- Last main CI: [30774177769](https://github.com/Arhaan2/million-beers-by-2035/actions/runs/30774177769), successful.
- Existing Pages URL: <https://arhaan2.github.io/million-beers-by-2035/>.
- Read-only API baseline: canonical total 1,107; 317 parent entries; 331 allocations. These are a live response, **not** a verified consistent database snapshot.
- Challenge configuration remains target 1,000,000; start `2026-07-24T00:00:00-07:00`; deadline `2035-01-01T00:00:00-08:00`; timezone `America/Los_Angeles`.
- Before desktop/mobile browser screenshots and API responses captured privately outside Git. Frozen baseline source retained for independent quality checks while local implementation proceeds. Formatting, lint, typecheck, Worker dry-run build, and frontend build passed. All 36 frontend tests passed; 41/42 API tests passed on the first run, with the pre-existing signature-tamper test intermittently substituting a base64 character without changing signature bytes. The test now mutates an actual signature byte; authentication behavior is unchanged.
- GitHub owner permissions verified; no open PRs; branch protection API reports no protection. No protections changed.
- Original Pages artifact expired. Deployed index and six static assets preserved privately with SHA-256 checksums; frozen baseline builds also pass.

## Phase status and gates

| Phase                        | Status                                                | Evidence / remaining gate                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Baseline and recovery      | BLOCKED for production                                | Git/source/CI/public API and preserved frontend checked. Cloudflare Worker/D1 calls still fail with authentication errors 10000/7403. No verified production export, private restoration, live immutable-ID manifest, remote migration inventory, Worker version, or Time Travel retention/bookmark. |
| 1 Reliability                | IMPLEMENTED BUT DISABLED in production                | Revision ordering, queued reconciliation, confirmed/unknown outcomes, exact durable retries and shared draft locking pass regression tests and real browser response-loss/reload tests.                                                                                                              |
| 2 Crew directory             | IMPLEMENTED BUT DISABLED in production                | Deterministic stable projection, old-write bridge, full picker, groups, history; owner changes are atomic/audited/reversible. Historical system classification awaits verified exact production IDs.                                                                                                 |
| 3 Occurrence and corrections | IMPLEMENTED BUT DISABLED in production                | Optional date/time with DST tests, separate recorded time, atomic append-only parent/allocation correction limits and retry/concurrency tests.                                                                                                                                                       |
| 4 Memories and history       | IMPLEMENTED BUT DISABLED in production                | Public text metadata, private-field enforcement, deterministic bounded history, member views and recaps. Photos BLOCKED: no confirmed secure storage/processing binding or allowance; controls hidden.                                                                                               |
| 5 Dashboard/mobile           | IMPLEMENTED BUT DISABLED in production                | Preserved dark/amber/cream identity, total hierarchy, navigation and six actual built-app browser/viewport cases pass.                                                                                                                                                                               |
| 6 Sharing/privacy/about      | IMPLEMENTED BUT DISABLED in production                | Saved-data export, explicit sharing, generic crawler preview and honest About metrics. Dynamic event previews, stronger authentication and editor invitations NOT IMPLEMENTED.                                                                                                                       |
| 7 Rehearsal                  | Synthetic checks PASS; production restoration BLOCKED | 74 Worker/D1 tests and 17 Python integrity/operator tests; original frontend reads/writes against expanded API. Compatible capability-off rollback tested after new writes. Real-data restoration rehearsal still requires Cloudflare access.                                                        |
| 8 Push/deploy                | Ready for safe PR; production BLOCKED                 | No remote migration, Worker deploy, merge, or Pages release. PR CI is read-only and cannot deploy; production requires exact backend source readiness.                                                                                                                                               |

## Non-negotiable release checks

1. Do not edit applied migrations, modify immutable ledger fields, reset a database, run synthetic production writes, or restore an old snapshot onto production.
2. Verify actual remote migration records before assigning/applying the candidate additive migration. Local numbering is provisional until that check passes.
3. Take a fresh protected export; restore it privately; reconcile parent/allocation/state/aggregates; capture immutable hashes per original ID. Compare IDs, not timestamps or a frozen expected total, after real intervening writes.
4. Prove old frontend/new API and old-code inserts/expanded schema. After privacy controls exist, the original Worker is not a safe rollback: it cannot honor projection privacy. Use the tested compatible API with new mutation capabilities disabled.
5. Deploy only an exact committed candidate after CI, full transaction-path tests, recovery rehearsal, and independent safety review. Backend readiness precedes merge and Pages. Preserve the repository base path.
6. Optional unavailable features must be hidden and reported honestly. No R2 activation, billing changes, stronger identity claims, inferred personal contact details, or pretend uploads.

## Checkpoints

Each coherent phase is committed on the feature branch. Final release evidence records test commands/results, browser engine limitations, compatibility, enabled capabilities, commit/PR/CI/release links, and unresolved gates. Documentation does not substitute for database evidence.

### Backend/data checkpoint

- Candidate additive migrations 0003 (crew/revision/metadata/corrections) and 0004 (atomic owner audit operations) pass isolated tests; numbering remains subject to remote verification. Applied source migrations 0001/0002 are unchanged.
- Actual Workers/D1 runtime: 74/74 API tests passed, including concurrency, legacy bridges, failed migration rollback/resumption, pagination, privacy, and capability-off rollback after new writes.
- Synthetic Python integrity/operator suite: 17/17 passed. No production SQL export exists: backup/restore and checkpoint preservation of live IDs remain blocked by Cloudflare authorization.
- No historical operational entries classified: exact production-ID evidence has not been verified. New community counts currently exclude only explicitly classified records.

### Frontend/reliability checkpoint

- Formatting, lint, and typecheck passed for the complete candidate. Frontend: 77/77 tests; API: 74/74 actual Worker/D1 tests; Python: 17/17. Both builds passed.
- Independent review found and resolved a cross-tab autosave/discard race; every shared-draft mutation now joins the submission lock and confirmed completion clears only its exact key. No new submission is dispatched without durable shared storage and a safe lock. Exact unresolved retries retain their original payload.
- Desktop/mobile dashboard rendered in Chromium, Firefox, and WebKit. Chromium/Firefox console clean; WebKit console clean before screenshots, with a reproduced screenshot-tool stylesheet CSP message after capture only. Production CSP was not weakened.
- Preserved original frontend renders the synthetic new API and successfully logs a synthetic +1 through its original shared-code form; totals and parent count increase once.
- Shareable before/after screenshots in `docs/qa` contain synthetic local data only. Live before evidence remains outside Git. Full scripted browser write/retry/route checks subsequently passed in all six engine/viewport cases.

### Release verification checkpoint

- `npm run test:browser`: six complete cases passed, using Chromium, Firefox and WebKit at 1440×1000 desktop and 390×844 touch emulation against a fresh actual local Worker/D1. Every case exercises login, single/group recording, linked partial correction, commit-response loss, modal closure/reload/reauthentication and retry of the original exact key. Directory beyond the leaderboard, hash routes/reload/back-forward, malformed/missing records, keyboard focus and horizontal overflow checks passed. No unexpected application or network errors. See the sanitized [synthetic browser report](qa/browser-report.json).
- WebKit's screenshot helper injects a stylesheet and produces a known CSP diagnostic only during screenshot capture; that diagnostic is separately counted. Planned response-abort diagnostics are also separately counted. Application CSP/CORS checks remain enforced.
- `npm run test:release`: 20 actual-script local HTTP tests pass, including malformed/missing readiness values and schema, unsupported schema, incorrect source tag, unavailable capabilities, bad HTTP status and non-JSON responses. Readiness requires strict boolean values and supported integer schema 3.
- Independent review resolved both final release-control findings: strict readiness validation and a manual main-only executable original-frontend rollback workflow retaining the compatible API. No unresolved core integrity/privacy finding was reported by the independent reviewer.
- Hosted preview is unavailable because Cloudflare Worker/D1 access is rejected. Equivalent built-artifact testing ran locally, with synthetic fixtures, noindex headers, isolated credentials/configuration and separate temporary state. No physical device testing was performed.
- Existing dependency audit reports nine pre-existing development-tool dependency advisories (four moderate, five high); no blind dependency upgrades were made. The added browser runner is pinned to Playwright 1.63.0.
- Rechecked remote main: still `ab746e2aabec8774cf5f025ab466c68bf31377d8`. Rechecked D1 migration access: still authentication-rejected. The final read-only public response remains 1,107 total, 317 parent entries and 331 allocations, matching the initial public observation. No production entry was created, classified, corrected, or modified by this work. Matching public totals cannot prove per-ID preservation or replace a consistent database snapshot; that production gate remains open.

- Final same-data before/after screenshots were inspected at 1440×1050 and 390×844. Saved occasion/recap card exports produced valid 1200×630 PNGs; copy-link routes matched and no automatic share or mutation occurred. All local browser/Worker servers were stopped.
