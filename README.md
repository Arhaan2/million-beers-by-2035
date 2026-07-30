# The Million Beer Project

One crew. One impossible number. By 2035.

The Million Beer Project is a public, responsive dashboard for a collective challenge to record 1,000,000 beers before January 1, 2035. Anyone can read the live scoreboard. Crew members with the shared code can append positive entries or explicit negative corrections.

- Live site: <https://arhaan2.github.io/million-beers-by-2035/>
- API health: <https://million-beers-api.arhaan2.workers.dev/health>

This is a counter, not a consumption recommendation. It never calculates a per-person target.

## Architecture

```mermaid
flowchart LR
  Browser[Public React dashboard] -->|HTTPS JSON| Worker[Cloudflare Worker API]
  Worker -->|Parameterized SQL| D1[(Cloudflare D1)]
  GitHub[GitHub Actions] -->|Build and deploy| Pages[GitHub Pages]
  Pages --> Browser
```

The browser never mutates repository files and contains no GitHub token, crew code, session-signing secret, or database credential. The only public build-time configuration is the Worker URL.

## Features

- Live total, visible low-percentage progress, countdown, group pace math, milestones, and projected finish
- 30-day accessible SVG trend, recent append-only activity, and net contributor leaderboard
- Keyboard-accessible shared-code login and update modals
- Positive quick additions, custom amounts, group splits, and confirmed negative corrections
- Equal or manual integer allocation across 2–25 named participants, with an exact-allocation review
- One grouped activity card per submission with an accessible per-person allocation disclosure
- Session tokens kept in `sessionStorage`; optional nickname kept in `localStorage`
- Polling every 25 seconds while visible with last-known-good data preserved on transient failures
- Signed 12-hour editor sessions, hashed-IP rate limits, idempotent submissions, and atomic D1 aggregate updates
- Reduced-motion support, semantic landmarks, focus styles, live regions, mobile layouts, and no analytics

## Repository layout

```text
apps/web/       React, TypeScript, Vite, Vitest, and static assets
apps/api/       Cloudflare Worker, D1 migration, and Workers-runtime tests
scripts/        Production-safe net-zero smoke test
.github/        GitHub Pages workflow
```

## Requirements

- Node.js 24 (use `nvm use`)
- npm
- GitHub CLI (`gh`)
- Wrangler authentication (`npx wrangler login`)
- OpenSSL for random local and production secrets

## Local setup

```bash
nvm use
npm ci
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Replace every placeholder in `apps/api/.dev.vars`. Use a development-only crew code and at least 32 random bytes for both signing values:

```bash
openssl rand -hex 32
```

Never commit `.dev.vars`; it is ignored. Apply the local migration and start each application in a separate terminal:

```bash
npm run db:migrate:local
npm run dev:api
npm run dev:web
```

The local dashboard runs at `http://localhost:5173` and calls `http://localhost:8787` from `apps/web/.env.example` / `.env.test` configuration.

## Quality commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Worker tests use Cloudflare's current Vitest integration inside the Workers runtime. D1 migrations are applied to isolated test storage before integration tests.

Run the full local group sequence after starting the Worker:

```bash
npm run dev:api
# In another terminal:
npm run smoke:group:local
```

The sequence records a single-person +3, a four-person +12, an exact idempotent retry, and a four-person -12 correction. It verifies entry and allocation counts and rejects mismatched and duplicate-name payloads.

## D1 and Worker deployment

The Worker name is `million-beers-api`; the binding is `DB`; the database name is `million-beers-production`.

```bash
cd apps/api
npx wrangler d1 create million-beers-production
# Put the returned database_id in wrangler.jsonc.
npx wrangler d1 migrations apply million-beers-production --remote
npx wrangler secret put BEER_ADMIN_PIN
npx wrangler secret put SESSION_SIGNING_SECRET
npx wrangler secret put RATE_LIMIT_SALT
npx wrangler deploy
```

Generate the signing secret and rate-limit salt independently with `openssl rand -hex 32`. Enter them directly at Wrangler's prompt. Do not save production values in the repository or a Vite variable.

To rotate the crew code securely:

```bash
cd apps/api && npx wrangler secret put BEER_ADMIN_PIN
```

Existing stateless sessions remain valid until their expiry when only the crew code is rotated. Rotate `SESSION_SIGNING_SECRET` to invalidate all current sessions.

### Challenge configuration

Edit the non-secret `vars` in `apps/api/wrangler.jsonc`, regenerate types with `npm run types --workspace @million-beers/api`, and redeploy. In particular:

- `CHALLENGE_TARGET`
- `CHALLENGE_START_ISO`
- `CHALLENGE_DEADLINE_ISO`
- `CHALLENGE_TIMEZONE`

The exact production deadline is `vars.CHALLENGE_DEADLINE_ISO` in `apps/api/wrangler.jsonc`.

## GitHub Pages deployment

Pushes to `main` run `.github/workflows/deploy-pages.yml`. The least-privilege workflow installs with `npm ci`, checks formatting, lint, types, and tests, builds with `VITE_BASE_PATH=/${{ github.event.repository.name }}/`, uploads only `apps/web/dist`, and deploys to the `github-pages` environment.

`apps/web/.env.production` contains only the public Worker URL. The production CSP in `apps/web/index.html` must list the exact Worker origin in `connect-src`.

## Single-person and group entries

Single-person mode remains the default and preserves the quick-amount workflow. “Split between people” starts with two participant rows and supports up to 25. “Split equally” uses integer division and assigns remainder beers to the first participants—for example, 10 across 3 becomes 4, 3, 3. Every allocation can be edited manually afterward. Fractional or zero allocations are never accepted.

Group submissions are reviewed before writing. The total must match the allocation sum exactly, and normalized participant names must be unique. Participant names are display labels, not authenticated accounts.

```json
{
  "totalAmount": 12,
  "allocations": [
    { "contributor": "Arhaan", "amount": 4 },
    { "contributor": "Sam", "amount": 3 },
    { "contributor": "Alex", "amount": 3 },
    { "contributor": "Rohan", "amount": 2 }
  ],
  "note": "Friday night hangout",
  "idempotencyKey": "browser-generated-uuid"
}
```

`POST /api/entries` returns one grouped entry, its allocations, aggregate entry/allocation counts, and an `idempotent` flag. Public responses never include normalization keys, idempotency keys, session fingerprints, or rate-limit identifiers. `POST /api/events` remains backward compatible and delegates to the same service with one allocation.

```json
{
  "entry": {
    "id": "server-generated-uuid",
    "totalAmount": 12,
    "note": "Friday night hangout",
    "createdAt": 1785463200000,
    "localDay": "2026-07-30",
    "isCorrection": false,
    "isGroup": true,
    "allocations": [{ "id": "allocation-uuid", "contributor": "Arhaan", "amount": 4 }]
  },
  "stats": {
    "total": 1234,
    "remaining": 998766,
    "entryCount": 100,
    "allocationCount": 142
  },
  "idempotent": false
}
```

Corrections are entered as positive absolute values in the browser, confirmed explicitly, and sent as a negative total with negative allocations. A correction reason of at least four characters is required. Corrections remain new append-only entries; no public edit or delete endpoint exists.

## Data model, migration, and idempotency

`beer_entries` stores one immutable parent per user submission. `beer_events` remains the per-person allocation ledger and links each allocation to its parent with `entry_id` and `allocation_index`. Challenge and daily aggregates track both entry count and allocation count; the public “Recorded updates” statistic uses entry count. Leaderboard totals continue to sum per-person allocations, while trend and pace calculations continue to use beer totals.

Migration `0002_group_entries.sql` creates the parent table, backfills one deterministic `legacy-<event-id>` parent for every historical event, links each old event as allocation index 0, and preserves totals, names, notes, and timestamps. Its compatibility trigger safely promotes any old-Worker insert made during the migration-to-deploy window. Never edit an applied migration.

Every entry carries one browser-generated UUID idempotency key. The parent unique constraint and D1 transactional batch ensure a timed-out exact retry returns the original grouped entry without incrementing any aggregate twice. Reusing a key with different payload data returns a conflict. Child allocation idempotency values are generated only by the Worker.

One atomic batch inserts the parent and every allocation, updates the challenge once, updates each contributor independently, and updates the daily aggregate once. Any failed child or aggregate operation rolls back the entire entry. A database check prevents the total from going below zero.

## Backup and export

Export production D1 before maintenance or schema changes. Keep the timestamped export outside the repository and confirm it is nonempty:

```bash
cd apps/api
BACKUP_PATH="../../../million-beers-production-$(date +%Y%m%d-%H%M%S).sql"
npx wrangler d1 export million-beers-production --remote --output="$BACKUP_PATH"
test -s "$BACKUP_PATH"
```

Treat exports as sensitive operational data even though the public API exposes only display fields. Store backups outside the repository.

For this migration, deploy in this order: finish local checks → export D1 → record integrity values → apply the remote migration → verify integrity → deploy the Worker → verify health and grouped summary → merge the frontend → verify GitHub Pages. This prevents the group-aware frontend from reaching an old API.

## Production smoke test

The smoke script uses a fresh +1 event, verifies an identical retry is idempotent, adds a separate -1 correction, and confirms the final total equals the starting total. It never prints the token or code.

```bash
API_BASE_URL=https://your-worker.workers.dev \
ORIGIN=https://arhaan2.github.io \
BEER_ADMIN_PIN='enter-code-in-your-shell' \
npm run smoke
```

The two zero-net audit events remain in the append-only production ledger and are clearly attributed to `Production Smoke Test`.

## Security model

The crew code is validated only in the Worker and stored only as a Cloudflare secret. Login limits use salted SHA-256 identifiers; raw IP addresses are never stored. Editor tokens are short-lived HMAC-SHA-256 signed values. Mutation limits combine the hashed IP with the session token ID. Browser origins are explicit, but CORS is defense in depth rather than authentication.

All SQL is fixed and parameterized. Public responses exclude idempotency keys, session fingerprints, rate-limit state, and hashes. See [SECURITY.md](SECURITY.md) for the threat model and incident response guidance.

> Never place a secret in any `VITE_*` environment variable. Vite values are compiled into the public browser bundle.

## Troubleshooting

- **Pages returns 404:** confirm Pages build type is GitHub Actions, the workflow succeeded, and the URL includes `/million-beers-by-2035/`.
- **Assets 404:** the workflow must set `VITE_BASE_PATH=/${{ github.event.repository.name }}/`. Do not use root-relative public asset paths.
- **CORS failure:** add only the browser's origin (scheme + host, no repository path) to `ALLOWED_ORIGINS`, regenerate types, and redeploy.
- **Expired editor session:** log in again. Tokens intentionally expire after `SESSION_TTL_SECONDS`.
- **D1 migration failure:** run `npx wrangler d1 migrations list million-beers-production --remote`, inspect the unapplied migration, and never edit an already-applied migration.
- **Worker secret missing:** check names with `npx wrangler secret list`; re-enter the missing value with `npx wrangler secret put NAME`.
- **Pages Action permissions failure:** repository Settings → Actions → General must allow GitHub Actions, and Pages must use GitHub Actions as its source. The workflow's declared permissions must remain intact.

## Responsible use

For adults of legal drinking age. Track responsibly. This counter is not a drinking recommendation. Never drink and drive.

Licensed under the MIT License.
