import { ApiError } from './responses';
import { canonicalEntryPayload, hasExtendedInput, normalizeContributorKey } from './schemas';
import {
  capabilities,
  groupPublicEntries,
  memoryValues,
  publicEntry,
  publicEntriesStatement,
  publicTextCondition,
  requireUpgradeWrites,
} from './crew';
import type { Database, PublicEntryRow } from './crew';
import type {
  CreateEntryResult,
  EntryInput,
  EntryStats,
  EventInput,
  RecordEventResult,
} from './types';

interface EventRow {
  [key: string]: unknown;
  id: string;
  amount: number;
  contributor: string;
  note: string | null;
  created_at: number;
  local_day: string;
}

interface EntryRow {
  id: string;
  idempotency_key: string;
  payload_json: string | null;
  total_amount: number;
  note: string | null;
  allocation_count: number;
  created_at: number;
  local_day: string;
}

interface AllocationRow {
  id: string;
  entry_id: string;
  allocation_index: number;
  amount: number;
  contributor: string;
  contributor_key: string;
}

interface StateRow {
  total: number;
  event_count: number;
  entry_count: number;
  updated_at: number;
  revision: number;
}

export function localDayFromTimestamp(timestampMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestampMs));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function readEntryByIdempotency(
  database: D1Database | D1DatabaseSession,
  idempotencyKey: string,
): Promise<{ row: EntryRow; allocations: AllocationRow[] } | null> {
  const row = await database
    .prepare(
      `SELECT e.id, e.idempotency_key, e.total_amount, e.note, e.allocation_count, e.created_at, e.local_day, m.payload_json
       FROM beer_entries e LEFT JOIN entry_metadata m ON m.entry_id = e.id WHERE e.idempotency_key = ?`,
    )
    .bind(idempotencyKey)
    .first<EntryRow>();
  if (!row) return null;
  const allocations = await database
    .prepare(
      `SELECT id, entry_id, allocation_index, amount, contributor, contributor_key
       FROM beer_events WHERE entry_id = ? ORDER BY allocation_index ASC`,
    )
    .bind(row.id)
    .all<AllocationRow>();
  return { row, allocations: allocations.results };
}

function entryMatchesInput(
  existing: { row: EntryRow; allocations: AllocationRow[] },
  input: EntryInput,
): boolean {
  if (existing.row.payload_json !== null)
    return existing.row.payload_json === canonicalEntryPayload(input);
  if (hasExtendedInput(input)) return false;
  if (
    existing.row.total_amount !== input.totalAmount ||
    existing.row.note !== input.note ||
    existing.allocations.length !== input.allocations.length
  ) {
    return false;
  }
  return existing.allocations.every((allocation, index) => {
    const requested = input.allocations[index];
    return (
      requested !== undefined &&
      allocation.amount === requested.amount &&
      allocation.contributor_key === requested.contributorKey
    );
  });
}

async function readState(database: D1Database | D1DatabaseSession): Promise<StateRow> {
  const state = await database
    .prepare(
      `SELECT s.total, s.event_count, s.entry_count, s.updated_at, u.revision
       FROM challenge_state s JOIN upgrade_state u ON u.id = s.id WHERE s.id = 1`,
    )
    .first<StateRow>();
  if (!state) throw new ApiError(500, 'Unable to read challenge state.', 'database_read_failed');
  return state;
}

function publicStats(env: Env, state: StateRow): EntryStats {
  const target = Number(env.CHALLENGE_TARGET);
  return {
    total: state.total,
    remaining: Math.max(0, target - state.total),
    entryCount: state.entry_count,
    allocationCount: state.event_count,
    revision: state.revision,
  };
}

async function existingEntryResult(
  env: Env,
  existing: { row: EntryRow; allocations: AllocationRow[] },
  input: EntryInput,
  database: D1Database | D1DatabaseSession = env.DB,
): Promise<CreateEntryResult> {
  if (!entryMatchesInput(existing, input)) {
    throw new ApiError(
      409,
      'That idempotency key was already used for a different entry.',
      'idempotency_conflict',
    );
  }
  return {
    entry: await publicEntry(database, existing.row.id),
    stats: publicStats(env, await readState(database)),
    idempotent: true,
  };
}

export async function createBeerEntry(
  env: Env,
  input: EntryInput,
  sessionFingerprint: string,
  nowMs = Date.now(),
): Promise<CreateEntryResult> {
  const database = env.DB.withSession('first-primary');
  const originalInput = input;
  const existing = await readEntryByIdempotency(database, input.idempotencyKey);
  if (existing) return existingEntryResult(env, existing, input, database);
  if (hasExtendedInput(input)) await requireUpgradeWrites(database);
  input = await resolveAllocations(database, input);

  const entryId = crypto.randomUUID();
  const localDay = localDayFromTimestamp(nowMs, env.CHALLENGE_TIMEZONE);
  const allocationRows = input.allocations.map((allocation, index) => ({
    id: crypto.randomUUID(),
    entryId,
    allocationIndex: index,
    internalIdempotencyKey: `allocation:${entryId}:${index}`,
    ...allocation,
  }));
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO beer_entries
       (id, idempotency_key, total_amount, note, allocation_count, created_at, local_day, session_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entryId,
        input.idempotencyKey,
        input.totalAmount,
        input.note,
        allocationRows.length,
        nowMs,
        localDay,
        sessionFingerprint,
      ),
    ...allocationRows.map((allocation) =>
      database
        .prepare(
          `INSERT INTO beer_events
         (id, idempotency_key, amount, contributor, contributor_key, note, created_at, local_day,
          session_fingerprint, entry_id, allocation_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          allocation.id,
          allocation.internalIdempotencyKey,
          allocation.amount,
          allocation.contributor,
          allocation.contributorKey,
          input.note,
          nowMs,
          localDay,
          sessionFingerprint,
          entryId,
          allocation.allocationIndex,
        ),
    ),
    database
      .prepare(
        `UPDATE challenge_state
       SET total = total + ?,
           event_count = event_count + ?,
           entry_count = entry_count + 1,
           updated_at = ?
       WHERE id = 1
       RETURNING total, event_count, entry_count, updated_at`,
      )
      .bind(input.totalAmount, allocationRows.length, nowMs),
    ...allocationRows.map((allocation) =>
      database
        .prepare(
          `INSERT INTO contributor_totals
         (contributor_key, display_name, net_total, event_count, updated_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(contributor_key) DO UPDATE SET
           display_name = excluded.display_name,
           net_total = contributor_totals.net_total + excluded.net_total,
           event_count = contributor_totals.event_count + 1,
           updated_at = excluded.updated_at`,
        )
        .bind(allocation.contributorKey, allocation.contributor, allocation.amount, nowMs),
    ),
    database
      .prepare(
        `INSERT INTO daily_totals
       (local_day, net_total, event_count, entry_count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(local_day) DO UPDATE SET
         net_total = daily_totals.net_total + excluded.net_total,
         event_count = daily_totals.event_count + excluded.event_count,
         entry_count = daily_totals.entry_count + 1,
         updated_at = excluded.updated_at`,
      )
      .bind(localDay, input.totalAmount, allocationRows.length, nowMs),
  ];
  if (input.correctionOfEntryId) {
    statements.splice(
      1,
      0,
      database
        .prepare('INSERT INTO entry_corrections (entry_id, source_entry_id) VALUES (?, ?)')
        .bind(entryId, input.correctionOfEntryId),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO entry_metadata (entry_id, occurred_at, occurred_day, occurrence_timezone, occurrence_precision, title, short_note, venue, city, beer, brewery, visibility, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entryId,
        input.occurredAt ? Date.parse(input.occurredAt) : null,
        input.occurredAt && input.occurrenceTimezone
          ? localDayFromTimestamp(Date.parse(input.occurredAt), input.occurrenceTimezone)
          : null,
        input.occurrenceTimezone ?? null,
        input.occurrencePrecision ?? null,
        ...memoryValues(input.memory),
        canonicalEntryPayload(originalInput),
      ),
  );
  if (input.correctionOfEntryId) {
    for (const allocation of allocationRows) {
      statements.push(
        database
          .prepare(
            'INSERT INTO allocation_corrections (allocation_id, source_allocation_id, amount) VALUES (?, ?, ?)',
          )
          .bind(allocation.id, allocation.sourceAllocationId ?? '', -allocation.amount),
      );
    }
  }
  statements.push(
    database.prepare(
      'SELECT s.total, s.event_count, s.entry_count, s.updated_at, u.revision FROM challenge_state s JOIN upgrade_state u ON u.id = s.id WHERE s.id = 1',
    ),
  );
  const stateResultIndex = statements.length - 1;

  try {
    const results = await database.batch(statements);
    const stateRows = results[stateResultIndex]?.results as StateRow[] | undefined;
    const state = stateRows?.[0];
    if (!state) throw new Error('Aggregate update did not return challenge state');
    return {
      entry: await publicEntry(database, entryId),
      stats: publicStats(env, state),
      revision: state.revision,
      idempotent: false,
    };
  } catch (error) {
    // A concurrent request may have won the unique parent-key race. Start a
    // primary-anchored session so the winner is visible before deciding whether
    // this is an exact retry or a conflicting key reuse.
    const session = env.DB.withSession('first-primary');
    const concurrent = await readEntryByIdempotency(session, input.idempotencyKey);
    if (concurrent) return existingEntryResult(env, concurrent, originalInput, session);
    const message = error instanceof Error ? error.message : '';
    if (message.includes('feature_disabled'))
      throw new ApiError(
        503,
        'Enhanced entry features are temporarily unavailable. Existing entry recording remains available.',
        'feature_disabled',
      );
    if (message.includes('correction_allowance'))
      throw new ApiError(
        409,
        'This correction exceeds the remaining amount on its original entry or allocation.',
        'correction_allowance',
      );
    if (message.includes('duplicate_member'))
      throw new ApiError(
        400,
        'A member may appear only once in an entry, including aliases.',
        'duplicate_member',
      );
    if (input.totalAmount < 0) {
      const state = await readState(session);
      if (state.total + input.totalAmount < 0) {
        throw new ApiError(409, 'A correction cannot make the total negative.', 'negative_total');
      }
    }
    throw new ApiError(500, 'Unable to record the entry.', 'database_write_failed');
  }
}

export async function recordEvent(
  env: Env,
  input: EventInput,
  sessionFingerprint: string,
  nowMs = Date.now(),
): Promise<RecordEventResult> {
  const result = await createBeerEntry(
    env,
    {
      totalAmount: input.amount,
      allocations: [
        {
          contributor: input.contributor,
          contributorKey: normalizeContributorKey(input.contributor),
          amount: input.amount,
        },
      ],
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    },
    sessionFingerprint,
    nowMs,
  );
  const allocation = result.entry.allocations[0];
  if (!allocation)
    throw new ApiError(500, 'Unable to read recorded event.', 'database_read_failed');
  return {
    event: {
      id: allocation.id,
      amount: allocation.amount,
      contributor: allocation.contributor,
      note: result.entry.note,
      createdAt: result.entry.createdAt,
      localDay: result.entry.localDay,
    },
    entry: result.entry,
    total: result.stats.total,
    ...(result.stats.revision !== undefined ? { revision: result.stats.revision } : {}),
    idempotent: result.idempotent,
  };
}

function recentCalendarDays(nowMs: number, timezone: string): string[] {
  const today = localDayFromTimestamp(nowMs, timezone);
  const [yearText, monthText, dayText] = today.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return Array.from({ length: 30 }, (_, index) =>
    new Date(Date.UTC(year, month - 1, day - (29 - index))).toISOString().slice(0, 10),
  );
}

export async function getSummary(env: Env, nowMs = Date.now()): Promise<unknown> {
  const database = env.DB.withSession('first-primary');
  const target = Number(env.CHALLENGE_TARGET);
  const days = recentCalendarDays(nowMs, env.CHALLENGE_TIMEZONE);
  // One read transaction: the revision and every returned projection describe
  // the same snapshot even when an old client writes while the request runs.
  const results = await database.batch<Record<string, unknown>>([
    database.prepare(
      'SELECT s.total, s.event_count, s.entry_count, s.updated_at, u.revision, u.mutations_enabled, u.schema_version FROM challenge_state s JOIN upgrade_state u ON u.id = s.id WHERE s.id = 1',
    ),
    publicEntriesStatement(database),
    database.prepare(`SELECT a.id, a.amount,
      CASE WHEN cm.public_display = 0 THEN 'Private member' ELSE a.contributor END AS contributor,
      CASE WHEN ${publicTextCondition} THEN a.note ELSE NULL END AS note, a.created_at, a.local_day
      FROM beer_events a JOIN beer_entries e ON e.id = a.entry_id
      LEFT JOIN entry_metadata m ON m.entry_id = e.id
      LEFT JOIN allocation_members am ON am.allocation_id = a.id LEFT JOIN crew_members cm ON cm.id = am.member_id
      ORDER BY a.created_at DESC, a.allocation_index ASC, a.id DESC LIMIT 25`),
    database.prepare(`SELECT c.display_name, c.net_total, c.event_count FROM contributor_totals c
      LEFT JOIN member_aliases a ON a.alias_key = c.contributor_key LEFT JOIN crew_members m ON m.id = a.member_id
      WHERE coalesce(m.public_display, 1) = 1 ORDER BY c.net_total DESC, c.updated_at ASC LIMIT 10`),
    database
      .prepare(
        'SELECT local_day, net_total, event_count, entry_count FROM daily_totals WHERE local_day >= ? ORDER BY local_day',
      )
      .bind(days[0]),
    database.prepare(
      'SELECT COUNT(*) AS crewSize FROM contributor_activity WHERE positive_allocations > 0',
    ),
    database
      .prepare(
        `SELECT
      (SELECT COUNT(*) FROM crew_members WHERE public_display = 1) AS directorySize,
      (SELECT COUNT(*) FROM community_member_activity a JOIN crew_members m ON m.id = a.member_id WHERE a.positive_allocations > 0 AND m.public_display = 1) AS namedContributors,
      (SELECT COUNT(*) FROM community_member_activity a JOIN crew_members m ON m.id = a.member_id WHERE a.positive_allocations > 0 AND m.public_display = 1 AND a.last_recorded_at >= ?) AS activeParticipants,
      (SELECT entry_count FROM challenge_state WHERE id = 1) - (SELECT COUNT(*) FROM entry_classification WHERE is_system = 1) AS entryCount`,
      )
      .bind(nowMs - 30 * 86_400_000),
    publicEntriesStatement(
      database,
      'NOT EXISTS (SELECT 1 FROM entry_classification c WHERE c.entry_id = e.id AND c.is_system = 1)',
    ),
  ]);
  const state = results[0]?.results[0] as
    (StateRow & { mutations_enabled: number; schema_version: number }) | undefined;
  if (!state) throw new ApiError(503, 'The database is not ready.', 'schema_not_ready');
  const daily = results[4]?.results ?? [];
  const dailyMap = new Map(daily.map((row) => [String(row.local_day), row]));
  const entries = groupPublicEntries((results[1]?.results ?? []) as PublicEntryRow[]);
  return {
    revision: state.revision,
    capabilities: capabilities(state),
    challenge: {
      target,
      startAt: env.CHALLENGE_START_ISO,
      deadlineAt: env.CHALLENGE_DEADLINE_ISO,
      timezone: env.CHALLENGE_TIMEZONE,
    },
    stats: {
      total: state.total,
      remaining: Math.max(0, target - state.total),
      eventCount: state.entry_count,
      entryCount: state.entry_count,
      allocationCount: state.event_count,
      crewSize: Number(results[5]?.results[0]?.crewSize ?? 0),
      percentComplete: target > 0 ? Math.min(100, (state.total / target) * 100) : 100,
      updatedAt: state.updated_at,
      revision: state.revision,
    },
    community: {
      ...results[6]?.results[0],
      definitions: {
        directorySize: 'Public member records; not verified people or accounts.',
        namedContributors:
          'Public named members with a positive allocation, excluding verified system records.',
        activeParticipants:
          'Those named contributors with a recorded allocation in the last 30 days.',
        entryCount:
          'Recorded submissions excluding verified system records; not verified gatherings.',
      },
    },
    recentEntries: entries,
    recentCommunityEntries: groupPublicEntries((results[7]?.results ?? []) as PublicEntryRow[]),
    recentEvents: ((results[2]?.results ?? []) as EventRow[]).map((row) => ({
      id: row.id,
      amount: row.amount,
      contributor: row.contributor,
      note: row.note,
      createdAt: row.created_at,
      localDay: row.local_day,
    })),
    leaderboard: (results[3]?.results ?? []).map((row) => ({
      contributor: row.display_name,
      netTotal: row.net_total,
      eventCount: row.event_count,
    })),
    dailyTotals: days.map((localDay) => {
      const row = dailyMap.get(localDay);
      return {
        localDay,
        netTotal: row?.net_total ?? 0,
        eventCount: row?.entry_count ?? 0,
        allocationCount: row?.event_count ?? 0,
      };
    }),
  };
}

async function resolveAllocations(database: Database, input: EntryInput): Promise<EntryInput> {
  const identities = new Set<string>();
  const sources = input.correctionOfEntryId
    ? (
        await database
          .prepare(
            'SELECT id, entry_id, amount, contributor, contributor_key FROM beer_events WHERE entry_id = ? ORDER BY allocation_index',
          )
          .bind(input.correctionOfEntryId)
          .all<AllocationRow>()
      ).results
    : [];
  if (input.correctionOfEntryId && (!sources.length || sources.some((row) => row.amount < 0)))
    throw new ApiError(
      400,
      'Linked corrections must target an existing positive entry.',
      'invalid_correction',
    );
  const allocations = [];
  for (const allocation of input.allocations) {
    let contributor = allocation.contributor;
    let contributorKey = allocation.contributorKey;
    if (input.correctionOfEntryId) {
      const source = sources.find((row) => row.id === allocation.sourceAllocationId);
      if (!source)
        throw new ApiError(
          400,
          'A correction allocation does not belong to its source entry.',
          'invalid_correction',
        );
      contributor = source.contributor;
      contributorKey = source.contributor_key;
    } else if (allocation.memberId) {
      const member = await database
        .prepare('SELECT display_name FROM crew_members WHERE id = ? AND public_display = 1')
        .bind(allocation.memberId)
        .first<{ display_name: string }>();
      if (!member)
        throw new ApiError(400, 'Select an available member from the directory.', 'invalid_member');
      contributor = member.display_name;
      contributorKey = normalizeContributorKey(contributor);
      const alias = await database
        .prepare('SELECT member_id FROM member_aliases WHERE alias_key = ?')
        .bind(contributorKey)
        .first<{ member_id: string }>();
      if (alias?.member_id !== allocation.memberId)
        throw new ApiError(
          409,
          'Member aliases need operator reconciliation before recording.',
          'member_alias_conflict',
        );
    }
    const alias = await database
      .prepare('SELECT member_id FROM member_aliases WHERE alias_key = ?')
      .bind(contributorKey)
      .first<{ member_id: string }>();
    const identity = input.correctionOfEntryId
      ? (allocation.sourceAllocationId ?? contributorKey)
      : (alias?.member_id ?? contributorKey);
    if (identities.has(identity))
      throw new ApiError(
        400,
        'A member may appear only once in an entry, including aliases.',
        'duplicate_member',
      );
    identities.add(identity);
    allocations.push({ ...allocation, contributor, contributorKey });
  }
  return { ...input, allocations };
}
