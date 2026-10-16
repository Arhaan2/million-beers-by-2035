# Next crew release — execution checkpoint

## Scope and invariants

Implement the October 16 release brief: reliable resource refresh and edit recovery; contextual recording and local group preferences; discoverable recaps and complete public exports; resilient share cards; installation assets with honest online requirements; factual partnerships; read-only preflight; verified normal release. Preserve the amber/cream design, shared-code/public-reading model, append-only ledger, correction limits, historical Crew Size and privacy projections. No new paid services, photos, identity platform, analytics, messages or production synthetic entries.

## Verified starting point — October 16, 2026

- Clean workspace on main; fetched origin/main is `bce5fe6ff68820ba6266cca6148ca95e268521c3`. No open PRs. Branch: `codex/next-crew-release`.
- Last hosted build and Pages deployment: [38461511710](https://github.com/Arhaan2/million-beers-by-2035/actions/runs/38461511710), successful. Public release.json matches main.
- Live health/readiness successful. Worker tag `crew-571550e9422d44df680672557ad708766a2cabe1`, schema 3, revision 441. All existing crew capabilities enabled; photos and strong identity disabled.
- Read-only public baseline: 1,472 total; 378 entries; 394 allocations; 37 historical named contributor records; 37 public named contributors; 7 recent active participants. These are observed data, not synthetic fixtures or audience metrics.
- Configuration unchanged: target 1,000,000; start July 24, 2026; deadline January 1, 2035; America/Los_Angeles calendar.
- Baseline frontend suite: 101/101 passed. Release-gate suite initially blocked by sandbox localhost-listen restrictions, to rerun with appropriate execution permission. Backend/browser/Python baseline pending.

## Decisions and dependencies

1. Lightweight resource revisions and explicit request sequencing; keep unsaved editors mounted.
2. Metadata/member uncertain outcomes reconcile server state before deliberate retry; ledger retries retain exact durable payload/key.
3. Add a generous hashed-network mutation ceiling alongside existing session ceiling; accepted exact retries bypass mutation budgets.
4. Reuse schema/revision tables. No migration currently expected. Full selected archive must abort if server revision changes, including privacy edits; never label partial exports complete.
5. Share cards use a single bounded text layout for landscape, square and story; no QR dependency. Names default off.
6. Ship raster/maskable/iOS installation assets and an explicit online requirement. No service worker/API cache: avoids stale privacy projections and incompatible cached shell without adding maintenance.
7. Backend content tag must match before merge/frontend deploy. Protected backup, restored-copy rehearsal and per-ID integrity checks still required even without migrations.

## Phase status

| Phase                         | Status      | Evidence / next step                                                                                             |
| ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| 0 baseline                    | In progress | Current source/live baseline above; reproduce A–F with synthetic tests                                           |
| 1 recovery and bounded writes | In progress | Parallel frontend/backend owners; contracts coordinated                                                          |
| 2 contextual recording        | In progress | Durable attempts take precedence over shortcuts                                                                  |
| 3 discovery and export        | In progress | Shared filter/revision contract across list, recap and export                                                    |
| 4 sharing                     | In progress | Bounded card renderer, preview and native file sharing                                                           |
| 5 phone access                | In progress | Install assets and explicit online requirement; no service worker                                                |
| 6 partnerships                | In progress | Existing contact only; timestamped ledger metrics                                                                |
| 7 preflight                   | Pending     | Read-only diagnostics, no migrations/feature toggles                                                             |
| 8 release                     | Pending     | Full local gates → exact-candidate CI → private rehearsal → Worker → merge → Pages → live read-only verification |

## Operational evidence and blockers

Private exports, restored databases, configuration inventories and live captures stay outside Git. No production mutation or deployment has occurred in this release. No external blocker confirmed yet. Current implementation base is the main commit above; coherent phase commits will be recorded here.

## Follow-ons only

Revocable editor invitations; approved photo storage/privacy; justified dynamic social previews; a separate generalized product only if explicitly chosen. None implemented in this run.
