# Guarded release and recovery

See [upgrade-plan.md](upgrade-plan.md) for actual execution status. These instructions are a resumable procedure, not proof of a completed deployment. All raw exports, SQL plans, row manifests, account metadata, and live screenshots stay in protected storage outside Git.

## Before any production operation

1. Verify `git status`, exact candidate commit, current remote main, PR checks, owner access, deployed Worker source/version, database binding/identity, and remotely applied migration records. Migrations 0003/0004 are now applied; future migration names must be checked against the actual remote history before assignment. Never edit or rerun an applied migration.
2. Save a fresh D1 export outside Git with restrictive directory/file permissions. Record a SHA-256 checksum and the current Time Travel bookmark plus verified retention. Restore the export into a fresh private local SQLite database and the supported isolated Worker runtime. Never restore onto production.
3. Run `python3 -B scripts/verify-ledger.py PRIVATE.sqlite --challenge PRIVATE-challenge.json --output PRIVATE-checkpoint.json`. The challenge file contains the four exact configured `CHALLENGE_*` values. The verifier checks state/parent/allocation totals, every parent allocation count, ordering, all contributor/day aggregates, and immutable hashes keyed by existing IDs. Subsequent runs use `--checkpoint PRIVATE-checkpoint.json` plus a new output path; real appended entries and corrections are allowed and reconciled.
4. On the private restored copy, rehearse only the pending additive migrations, old client requests, pre-group old Worker inserts, new requests, metadata edits, concurrent linked corrections, and privacy-aware capability-off rollback. Preserve all original hashes. Use separate synthetic data for screenshots and publicly shareable tests.
5. Pass `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:release`, `npm run build`, and `python3 -B -m unittest discover -s scripts -p 'test_*.py'`. Install the pinned browser engines with `npx playwright install --with-deps chromium firefox webkit`, then run `npm run test:browser` for built-artifact Chromium/Firefox/WebKit and mobile viewport checks against a fresh isolated local Worker/D1. Ports 8787 and 5173 must be free. The harness refuses remote test origins, strips inherited credentials, uses synthetic fixtures, and keeps evidence in a private temporary directory. Browser emulation is not physical-device testing.

Cloudflare's official [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [migration](https://developers.cloudflare.com/d1/reference/migrations/), and [Worker version](https://developers.cloudflare.com/workers/versions-and-deployments/) documentation and the installed Wrangler help govern remote commands. Do not use the old production smoke script.

## Release order

1. Push a coherent reviewed feature branch and PR. PR CI has read-only repository permission, never receives production secrets, and never deploys an artifact. Its concurrency group cannot cancel production.
2. Identify the exact tested clean candidate commit. Reconfirm main has not diverged and repeat affected tests after integration. Run `node scripts/api-source-tag.mjs` to identify the content tag covering API source, migrations, config, package metadata, and the lockfile.
3. Reconfirm a fresh backup/bookmark and integrity checkpoint immediately before remote changes. Apply only rehearsed pending additive migrations to the existing database. New mutation features default disabled. Validate preserved IDs plus intervening real writes after each step.
4. Deploy the exact candidate Worker with the content tag: from the repository root, `npx wrangler deploy --config apps/api/wrangler.jsonc --tag "$(node scripts/api-source-tag.mjs)" --keep-vars --strict`. Existing secrets are not rotated; inspect the current remote configuration before using this command. Confirm `/ready` and old public contracts while the previous frontend stays live.
5. Enable new capabilities only after data/schema/runtime gates pass. Prepare an owner capability plan against a fresh private snapshot with `scripts/crew-operator.py`, review it privately, and apply that single statement with owner D1 access. Verify read-only readiness again.
6. Merge the reviewed PR only after backend readiness. Pages Actions tests and builds the frontend with `VITE_BASE_PATH=/million-beers-by-2035/`; its deployment job requires the backend content tag to match. It publishes a non-secret `release.json` containing the frontend commit. Confirm the action completed and deployed asset hashes/release commit match.
7. Check live routes, total vs API, assets, login form, crew/history/details/recaps, browser console, and network errors read-only. Never submit artificial entries to production. Reconcile a fresh private snapshot against the checkpoint, allowing legitimate appended activity. Record exact release IDs, applied migrations, and enabled capabilities.

Documentation-only changes under `docs/`, README, or SECURITY do not trigger a production Pages deployment on push. Do not change runtime files as release bookkeeping.

## Operator plans

The CLI accepts a read-only private restored `--database`, new private `--output`, non-secret operator `--actor`, and meaningful `--reason`, followed by one of:

- `rename --member MEMBER_ID --name DISPLAY_NAME`
- `privacy --member MEMBER_ID --visibility public|hidden`
- `merge --source MEMBER_ID --destination MEMBER_ID`
- `classify --entry EXACT_ENTRY_ID --kind system|community --evidence VERIFIED_EVIDENCE`
- `capabilities --state enabled|disabled`
- `reverse --audit AUDIT_ID`

The resulting file contains one guarded `INSERT` into the audit table. Trigger checks and projection updates run atomically with that statement; do not split it or translate it into unguarded SQL. Existing owner access, not the crew code, is the authorization boundary. If a snapshot precondition fails, obtain fresh private data and investigate. Never force a stale plan.

## Rollback

For a frontend regression after the release is on main, run `gh workflow run rollback-pages.yml --ref main`, then inspect that run and verify its deployed `release.json`. This manual-only, main-only workflow rebuilds the immutable original frontend at `ab746e2aabec8774cf5f025ab466c68bf31377d8` from its original lockfile, tests and typechecks it, preserves `/million-beers-by-2035/`, and deploys it through the existing Pages environment. It checks the retained compatible backend source before building and again before deployment, shares the production concurrency group, and never migrates or deploys the Worker. The same frozen original source was built locally and its original login and +1 write were tested against the expanded API using synthetic data. The hosted rollback job has not been invoked. Its original-frontend/compatible-API path has been tested locally; no hosted rollback execution is claimed. The original deployed index/assets also remain preserved privately with checksums as a secondary recovery artifact. Retain the expanded compatible API/schema. Verify its base path and test old frontend requests against that API. If necessary disable new mutation capabilities with an audited operator plan; legacy name-only recording remains available and exact pending enhanced attempts retain their keys for later resolution.

The original pre-upgrade Worker is **not** a safe rollback once privacy settings exist: it ignores the privacy projection. The rollback target must be a verified compatible privacy-aware Worker with new mutations disabled. Keep all additive tables, all accepted entries, occurrence/memory metadata, and correction links. The current code's capability-off behavior must be exercised after representative new writes, not merely dry-run built.

Do not restore an earlier D1 snapshot or use Time Travel restore automatically. That can discard later real entries. Disaster recovery requires an explicit operator decision and preservation/replay of intervening writes. A Git tag alone is not evidence of database rollback safety.
