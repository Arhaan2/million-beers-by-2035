# Crew upgrade architecture and contracts

The counter remains the append-only `beer_entries`/`beer_events` ledger. Its target, calendar configuration, recorded timestamps, source contributor labels, allocation order, and original idempotency values retain their meanings. Migration 0001 and 0002 are unchanged. New side tables hold member mappings, optional memory/occurrence fields, linked corrections, operational classifications, projection activity, revision state, and administrative audit records.

## Compatibility and ordering

`POST /api/events` and `POST /api/entries` retain their existing bodies and legacy response fields. Name-only clients remain supported; insertion triggers create member mappings in the same transaction, including the original pre-group Worker compatibility path. Anonymous remains outside the member directory. Mapping chooses one opaque member ID for each exact existing normalized name; similar names are never automatically merged. Existing spelling variations remain original source labels and may appear as aliases.

Summary and mutation responses add a monotonically advancing `revision`. Parent insertion, projection metadata changes, classification, and operator actions advance it, including negative adjustments. A primary-anchored D1 read batch makes the summary and revision a consistent snapshot. Summary uses `Cache-Control: no-store`; the browser immediately applies confirmed mutation statistics, rejects older revisions, and queues reconciliation behind an in-flight fetch. Total amount is never an ordering signal.

New entry attempts store their canonical original payload independently of mutable memory/member projections. Exact retries retain the original result; different metadata with the same key conflicts. Existing requests continue their prior normalization semantics. The browser persists a versioned, project-namespaced draft and exact pending attempt without credentials, guards retries across tabs, and distinguishes confirmed save with failed refresh from rejected and unknown outcomes. Unknown attempts require resolution with the original key; they are not automatically expired or changed into new submissions.

## API extensions

| Method/path                      | Purpose                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                    | Process liveness; no database guarantee.                                                                              |
| `GET /ready`                     | Database/schema checks, non-secret Worker version tag, server-enforced capabilities, and revision.                    |
| `GET /api/members`               | Bounded public directory; `q`, `cursor`, `limit` (1–50).                                                              |
| `POST /api/members`              | Explicit shared-editor creation of a display label (`displayName`), never a verified account.                         |
| `GET /api/members/:id`           | Public member projection and paginated source history.                                                                |
| `GET /api/entries`               | Recorded history with `memberId`, `from`, `to`, `dateBasis`, `q`, `venue`, `brewery`, `community`, `cursor`, `limit`. |
| `GET /api/entries/:id`           | Source entry, ordered allocations, correction linkage, and remaining linked-correction allowance.                     |
| `PUT /api/entries/:id/memory`    | Shared-editor public memory text update with `expectedVersion`; changes metadata without recording quantity.          |
| `GET /api/milestones`            | Completed recorded-day milestone closes; no intraday crossing claim.                                                  |
| `GET /api/memories/on-this-date` | Known supplied occurrence dates only, excluding private/system records.                                               |
| `GET /api/recaps?period=YYYY-MM` | Recorded-month recap and contributing history; `YYYY` selects a year.                                                 |

History cursors order by immutable recording time and ID, so equal timestamps have a deterministic tie-breaker. Occurrence filters use a separate stored local occurrence day; unknown occurrence dates are not invented. Search uses parameterized, bounded values and escapes SQL wildcard characters. Summary retains only a bounded recent window; full history is fetched separately.

Entry extensions are optional: allocation `memberId`, `occurredAt` (ISO instant), `occurrenceTimezone` (IANA timezone), `occurrencePrecision` (`day` or `minute`), `memory`, and `correctionOfEntryId`. Memory text fields are `title`, `shortNote`, `venue`, `city`, `beer`, and `brewery`; each is optional. New mutation capabilities default off in the migration. Supported exact retries still resolve while disabled; ordinary legacy quantity recording stays available.

Linked corrections are new negative ledger entries. Each allocation names its `sourceAllocationId`; the server resolves source identity and linkage. Database triggers enforce both remaining parent and per-allocation allowances inside the same transaction as all ledger and aggregate writes. Concurrent partial/full corrections cannot spend the same allowance twice. Legacy unlinked negative adjustments remain supported and labeled; their historical linkage is unknown, so they are not retroactively counted against a specific source allowance.

## Metrics and privacy

- **Canonical total:** all immutable signed quantity entries, including operational records and all corrections.
- **Raw entries/allocations and legacy crew size:** retain prior audit definitions.
- **Directory size:** public member records, which may have no allocations; neither verified people nor accounts.
- **Named contributors:** public mapped members with a positive community allocation.
- **Active participants:** those named contributors with community recording activity in the previous 30 days.
- **Community entries:** submissions excluding operator-verified system records; not independently verified gatherings.
- **Recaps:** recorded-calendar quantities and participation with links to source records, excluding verified system records. Historical recorded dates do not prove when a gathering happened. Milestone history uses only completed recorded-day cumulative closes, not an invented intraday sequence.

Classification requires exact entry IDs plus verified evidence through the owner operator, never a contributor-name heuristic. No production records have been classified unless release evidence explicitly says so. Exclusion changes only the new community projection, not the total or raw ledger.

Member privacy changes and alias merges require independent owner access. The shared code grants shared editing rights, not personal ownership. All public entry, summary, legacy event, directory, history, recap, and share data use server-filtered fields. Hidden member names are redacted, and associated free text is withheld to avoid leaking labels in notes. Existing public copies and screenshots cannot be recalled. Private memory visibility also withholds supplied occurrence fields and occurrence filters. Memory editing requires a version precondition and writes an audit row; shared editors cannot change an existing memory's visibility or edit private memory text.

Names are optional in exported cards. Sharing is initiated explicitly and uses saved API data. The static site's generic Open Graph/Twitter preview is crawler-visible; hash entry routes do not promise dynamic event previews. Photos and stronger personal authentication are not included: no suitable object-storage allowance or secure account provisioning has been confirmed, and no unusable controls should appear.

## Administrative reversibility

`scripts/crew-operator.py` prepares one private SQL statement from a private restored snapshot. Owner Wrangler access applies it. An audited database trigger validates the entire affected projection snapshot and atomically applies rename/privacy/merge/classification/capability operations. Source rows are untouched. Name collisions require an explicit merge; merges across different visibility settings are refused. Reversal must exactly invert the saved audit snapshot and fails if intervening activity changed the affected projection. It cannot overwrite newer writes to force an old view back into place.
