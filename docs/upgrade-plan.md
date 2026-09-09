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
- Before desktop/mobile browser screenshots and API responses captured privately outside Git. Frozen baseline source retained for independent quality checks while local implementation proceeds. Formatting, lint, typecheck, Worker dry-run build, and frontend build passed. All 36 frontend tests passed; 41/42 API tests passed on the first run, with the pre-existing signature-tamper test intermittently substituting a base64 character without changing signature bytes. The test is being fixed to mutate an actual signature byte.
- GitHub owner permissions verified; no open PRs; branch protection API reports no protection. No protections changed.
- Original Pages artifact expired. Deployed index and six static assets preserved privately with SHA-256 checksums; frozen baseline builds also pass.

## Phase status and gates

| Phase                        | Status                          | Evidence / remaining gate                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Baseline and recovery      | IN PROGRESS; production blocked | Git/source/CI/public API checked. Saved Cloudflare credential reports account access but Worker/D1 operations fail with 10000/7403. Database export, restore, remote migration identity, deployed Worker version, and Time Travel retention/bookmark are unverified. |
| 1 Reliability                | IN PROGRESS locally             | Reproduced skipped-refresh path and loss of uncertain attempt identity on modal closure by source inspection; regression tests required.                                                                                                                             |
| 2 Crew directory             | IN PROGRESS locally             | Stable projection, legacy-write bridge, searchable directory.                                                                                                                                                                                                        |
| 3 Occurrence and corrections | IN PROGRESS locally             | Separate optional occurrence metadata; linked append-only correction allowance enforced transactionally.                                                                                                                                                             |
| 4 Memories and history       | IN PROGRESS locally             | Bounded cursor history, metadata, member history, recaps. Photos gated on confirmed infrastructure.                                                                                                                                                                  |
| 5 Dashboard/mobile           | IN PROGRESS locally             | Preserve visual identity and exact counter; rendered synthetic browser checks required.                                                                                                                                                                              |
| 6 Sharing/privacy/about      | IN PROGRESS locally             | Public fields only; generic crawler-visible preview; explicit export/share.                                                                                                                                                                                          |
| 7 Rehearsal                  | PENDING                         | Synthetic Worker/D1 and rollback tests; private production-restoration rehearsal requires working D1 access.                                                                                                                                                         |
| 8 Push/deploy                | PENDING                         | Safe branch/PR allowed; no migration, Worker deploy, merge, or Pages release before recovery/readiness gates.                                                                                                                                                        |

## Non-negotiable release checks

1. Do not edit applied migrations, modify immutable ledger fields, reset a database, run synthetic production writes, or restore an old snapshot onto production.
2. Verify actual remote migration records before assigning/applying the candidate additive migration. Local numbering is provisional until that check passes.
3. Take a fresh protected export; restore it privately; reconcile parent/allocation/state/aggregates; capture immutable hashes per original ID. Compare IDs, not timestamps or a frozen expected total, after real intervening writes.
4. Prove old frontend/new API and old-code inserts/expanded schema. After privacy controls exist, the original Worker is not a safe rollback: it cannot honor projection privacy. Use the tested compatible API with new mutation capabilities disabled.
5. Deploy only an exact committed candidate after CI, full transaction-path tests, recovery rehearsal, and independent safety review. Backend readiness precedes merge and Pages. Preserve the repository base path.
6. Optional unavailable features must be hidden and reported honestly. No R2 activation, billing changes, stronger identity claims, inferred personal contact details, or pretend uploads.

## Checkpoints

Each coherent phase is committed on the feature branch. Final release evidence records test commands/results, browser engine limitations, compatibility, enabled capabilities, commit/PR/CI/release links, and unresolved gates. Documentation does not substitute for database evidence.
