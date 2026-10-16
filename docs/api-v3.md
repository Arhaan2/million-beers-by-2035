# Crew upgrade API and data model

This release extends the existing Worker and D1 ledger. Migrations `0001` and `0002` remain unchanged. New migration numbers are local candidates until the operator verifies the complete remote migration history. No deployment may assume that repository migrations equal production migrations.

## Immutable source and projections

`beer_entries`, `beer_events`, challenge configuration, original names/keys, amounts, notes, allocation order, recording timestamps and idempotency keys remain the source of truth. Existing aggregate meanings are retained, including recorded-day totals and legacy unlinked corrections.

Migration `0003` adds member, alias, allocation mapping, activity, metadata, classification, correction and audit side tables. One member is backfilled for each existing non-Anonymous normalized key, using the earliest `(created_at, id)` allocation as a deterministic opaque ID. Different source labels for one key are recorded in private `backfill_label_variants` audit records; this does not establish real-person identity. Similar names are never merged automatically. Anonymous remains unmapped and visible. The insert bridge creates aliases/mappings for both old single-event and old group clients, including during the migration/deployment window. It does not rewrite their source fields.

`upgrade_state.revision` is a monotonic commit ordering value, independent of increasing or decreasing totals. Parent insertion increments it, including parents created by the old-event compatibility trigger. Metadata, member projection, classification and supported operator changes also increment it. Summary reads use a primary-anchored D1 batch so all fields and the revision come from one read transaction. Summary and mutation responses use `Cache-Control: no-store`.

Migrations start `mutations_enabled = 0`. Directory/history/public memories can be read while enhanced mutation capabilities are disabled. Original name-only entries and legacy adjustments remain writable. Enhanced payloads are rejected by both API checks and a database trigger within the transaction. Exact retries of already committed payloads return the existing result even after a capability is disabled.

## Readiness and capabilities

`GET /health` remains process liveness. `GET /ready` returns 200 only when the database state, schema and required core/operator triggers are available, otherwise 503. It returns non-secret `release` (Worker version metadata tag, falling back to version ID; local builds identify themselves as local), `schemaVersion`, `revision` and `capabilities`.

Summary has additive top-level `revision`, `capabilities`, `community` and `recentCommunityEntries`. The latter contains the latest 25 submissions after operational-record exclusion; legacy `recentEntries` retains its raw ordering and definitions. Mutation statistics include `revision`. Read capabilities are `crew`, `history`, `memories`; gated write capabilities are `enhancedLogging`, `memberCreation`, `occurrence`, `linkedCorrections`, `metadataEditing`. `photos` and `strongIdentity` are false. A true read capability does not authorize its associated mutation.

## Additive entry contract

`POST /api/entries` retains its original required fields. Optional extensions are:

```json
{
  "allocations": [{ "contributor": "Display label", "memberId": "opaque-member-id", "amount": 2 }],
  "occurredAt": "2026-08-01T18:30:00-07:00",
  "occurrenceTimezone": "America/Los_Angeles",
  "occurrencePrecision": "minute",
  "memory": {
    "title": "Picnic",
    "shortNote": "An optional memory",
    "venue": "Park",
    "city": "City",
    "beer": "Optional text",
    "brewery": "Optional text",
    "visibility": "public"
  }
}
```

This is a fragment, not a complete submission: the original total, exact allocation sum, reason rules and UUID idempotency key are still required. Text fields are at most 80 characters except shortNote (140). Empty optional fields normalize to null. Unknown memory fields and invalid types are rejected. Memory fields are never mandatory.

Occurrence is separate from recording time. A supplied ISO timestamp must include an offset that matches its stated IANA timezone. Calendar rollovers, nonexistent local times, mismatched offsets, pre-2000 dates and dates more than five minutes in the future are rejected. Fall DST folds are distinguished by explicit offset. `day` precision requires local midnight; clients display it as a date, not an asserted event time. Historical entries have null occurrence fields and `occurrenceSource: "unknown"`. Recorded-date aggregates are unchanged; occurrence filters use the supplied local day.

An immutable canonical request is saved separately from editable metadata. Equality includes normalized original allocation identity inputs, occurrence fields, original memory visibility/text, source linkage and amounts. Renames, alias merges and metadata edits never change this saved request. A differing payload using the same key gets 409; exact retries preserve one ledger transaction.

## Linked corrections

New negative entries may add `correctionOfEntryId`; every allocation then requires `sourceAllocationId`. Zero reversals are omitted. The server loads the original source allocation and resolves its identity; it does not trust a supplied contributor label. Only positive source entries are correctable. Parent and per-allocation remaining allowances are checked inside database triggers in the same D1 batch as all inserted records and aggregate changes. Failed or racing excess corrections roll back in full. Exact duplicate retries consume no additional allowance.

Details expose `remainingCorrectable`, `sourceAllocationId`, `correctionOfEntryId` and `correctionKind: "linked" | "legacy" | null`. A historical alias merge can cause two distinct source allocations to map to one member; linked reversal preserves those distinct source allocations. Repeating the same source allocation is rejected. Ordinary new group entries reject duplicate member assignments across aliases. Legacy negative entries without source linkage remain valid and are explicitly labeled legacy adjustments; they do not consume a linked source allowance because no historical linkage can be established safely.

## Directory, history and recaps

All reads are public and redacted. No public response contains source keys, session fingerprints, original payload JSON, operator evidence or audit records.

| Endpoint                                        | Contract                                                                                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/members?q=&cursor=&limit=`            | `{revision,members,nextCursor}`. Stable opaque IDs, display names, public aliases, net totals and supported participation counts. Full-directory search, not leaderboard-only.                     |
| `POST /api/members`                             | Shared-editor `{displayName}` creates a member intentionally; returns `{revision,member}`. Normalization/alias collision returns 409. This does not create or claim an authenticated account.      |
| `GET /api/members/:id`                          | `{revision,member,history:{revision,entries,nextCursor}}`; private or missing members return 404.                                                                                                  |
| `GET /api/entries`                              | `{revision,entries,nextCursor}` with `memberId`, `from`, `to`, `dateBasis` (`recorded` or `occurred`), `q`, `venue`, `brewery`, `city`, `community=true`, `cursor`, `limit`, optional `revision`.  |
| `GET /api/entries/:id`                          | `{revision,entry,corrections}` with original positive/negative amounts and public linked correction details.                                                                                       |
| `GET /api/recaps?period=YYYY[-MM]`              | Recorded-month/year community net total, entry count, participant count, public-place highlights, available months and a page of contributing records, read with `revision` in one D1 transaction. |
| `GET /api/memories/on-this-date?monthDay=MM-DD` | Explicit public occurrence dates only; `{revision,dateBasis:"occurred",monthDay,entries,nextCursor}`. Missing historical dates are never treated as known occurrence dates.                        |
| `PUT /api/entries/:id/memory`                   | Shared-editor `{memory,expectedVersion}` returns `{revision,entry}`, with an optimistic version check and audit in the same batch. It never records amounts again.                                 |

Pages default to 25, maximum 50. Entry cursors use recording timestamp plus ID as a deterministic tie-breaker; new appends do not cause duplicate pages. Directory cursors order by stable ID. Search values and date ranges are validated, SQL is parameterized, and date/member/source lookup paths are indexed. Text substring search can scan matching ledger ranges; no large-production performance claim is made without a private production rehearsal. Full history is absent from the polled summary.

Recaps use the same complete-record predicates as history for member, text, venue, brewery and city filters. `period` defines the recorded date range and recaps always exclude classified system records; `dateBasis`, `from`, `to` and `community` cannot override those recap definitions. Aggregate queries omit only the page cursor and limit. A member filter selects whole entries containing that public member, so amounts and participants describe those complete entries, not only that member's allocations. Negative corrections retain their signed amounts and only match a place/text filter when their own public metadata matches; no source-entry metadata is inferred onto a correction.

`entryCount` counts submissions, including corrections. `participantCount` counts distinct public member IDs with positive allocations in the matching records, not verified people. `publicPlaceCount` counts distinct public venue/city pairs; `cityCount` and `breweryCount` count distinct public values. These place values are trimmed and case-folded using SQLite's built-in `lower` (ASCII case folding); no real-world place identity is asserted. Private memory and entries containing hidden members contribute no public-place values. `availableMonths` is a descending `YYYY-MM` list from actual matching community records across all recorded months; it uses the other recap filters but excludes the selected period and cursor. Valid recap years are `0001` through `9999`; empty periods return zero aggregates and no records. Recording days use the challenge timezone, including leap days and DST boundaries.

### Complete public archive export

An exporter requests `/api/entries` with its selected filters and a limit of at most 50, captures the first response's `revision`, and sends that exact revision on every subsequent cursor request. The API reads each page and its revision in a primary-anchored D1 transaction. Any intervening ledger insert, metadata edit, member privacy/projection change or supported classification change causes HTTP 409 `archive_changed`; the response contains no page. Malformed revisions return 400. This is an abort-and-restart policy, not a retained historical snapshot: current privacy always applies.

After reaching `nextCursor: null`, the exporter must make a final request with the same revision (a `limit=1` check is sufficient) before presenting a complete file. It must discard partial output on any change, cancellation or error; a complete export records its checked revision, filters and validation time. It must not cache pages in persistent browser storage. This policy covers all accepted pages and the final check, but cannot recall an already downloaded file or prevent a change immediately after the final check. A fresh export is required to reflect later privacy changes. Exported fields must be explicitly selected from public entry/allocation fields; operator exports, request keys, canonical payloads, session fingerprints and audit internals are never part of this endpoint.

### Mutation budgets and exact retries

All shared-editor mutations retain the existing salted IP-plus-session bucket (default 30 new attempts per 600 seconds). A second salted IP-only `mutation_network` bucket permits ten times that budget (default 300 per 600 seconds) so several friends can share a network while re-login cannot reset every applicable limit. No raw address or browser device identity is stored. A session rejection does not spend the shared-network budget; a permitted session attempt does. Successful login clears only its login bucket. These coarse controls do not establish personal identity or prevent someone from changing networks.

Authenticated exact retries of already accepted `/api/entries` or legacy `/api/events` resolve before either mutation budget is consumed, including after a fresh login or a capability disable. They still compare the canonical original payload; reuse of an accepted key with different content returns 409. Unknown attempts retain their original key and payload while waiting for a budget to reset. Member creation and memory editing remain subject to both budgets and their existing collision/version checks.

## Privacy and authorization limits

The shared crew code grants existing editing rights. It proves neither personal identity nor ownership of a member record. Member rename, alias merge and public-display changes require the independent owner operator, never a browser flag or shared-code admin route. `0004` applies an operator change and its audit as one guarded insert, and reversals reject intervening projection changes.

New memory visibility is an explicit creation-time choice. Private memory, occurrence information and original entry notes are not returned publicly. The same redaction applies to entries containing an operator-hidden member; that member's allocation label becomes "Private member" and its member ID is absent. Summary, legacy recent events/leaderboard, directory, history, details, recaps, mutation responses and exact retries use this policy. Private text/occurrence cannot be searched through a public filter. Amounts and original recording dates remain public so the canonical counter and raw audit counts still reconcile.

Shared editors can edit public memory text, but cannot change visibility or retrieve/edit private memory. Those operations require owner access; no private-memory browser editor is offered. Previously public copies, shared cards and screenshots cannot be recalled. Free text is unverified user content; contributors should not publish another person's details without consent.

## Metric definitions and rollback

Legacy `stats.crewSize` remains distinct normalized named source keys after their first positive allocation; it excludes Anonymous and retains corrected contributors. Legacy canonical totals, ledger counts, leaderboard source amounts and recorded-day totals are unchanged. Public privacy suppresses labels without changing raw amounts.

New `community.directorySize` counts public directory records; `namedContributors` counts public members with positive allocations; `activeParticipants` counts those members with a non-system allocation recorded in the last 30 days; `entryCount` counts submissions. These community metrics exclude only entries classified by exact ID and documented owner evidence. They are not verified people, gatherings, audience size or consumption goals. Classification never removes records, changes the canonical total or creates compensating entries.

The pre-upgrade Worker is **not a safe rollback** once private metadata or member privacy exists: it ignores redaction side tables. Use the tested privacy-aware compatible Worker with enhanced mutations disabled, and preserve the additive schema and all new records. The old frontend remains compatible with that Worker. Never restore an older database snapshot automatically.

Photos are not implemented or enabled: no confirmed secure object-storage binding or processing pipeline is configured. Stronger individual authentication and revocable editor invitations remain follow-on work. Exact historical intraday milestone crossing instants are not inferred from incomplete write-order evidence; the endpoint below reports completed recorded-day closes only.

## Recorded-day milestone history

`GET /api/milestones` returns `dateBasis: recorded-day-close`, a limitation label, and bounded `{amount, recordedDay, closingTotal}` milestones from cumulative `daily_totals`. It uses the first completed recorded day ending at or above each existing threshold. Today is excluded; intraday crossing instants remain unknown. This reads the existing recorded-day aggregate and never changes quantity or occurrence data.
