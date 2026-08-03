import { ApiError } from './responses';
import { ANONYMOUS_CONTRIBUTOR, normalizeContributorKey } from './schemas';
import type {
  CreateEntryResult,
  EntryInput,
  EntryStats,
  EventInput,
  PublicAllocation,
  PublicEntry,
  PublicEvent,
  RecordEventResult,
} from './types';

interface EventRow {
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
}

interface RecentEntryRow {
  entry_id: string;
  total_amount: number;
  entry_note: string | null;
  entry_created_at: number;
  entry_local_day: string;
  allocation_count: number;
  allocation_id: string;
  allocation_amount: number;
  contributor: string;
  allocation_index: number;
}

interface CrewSizeRow {
  crew_size: unknown;
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function toPublicEvent(row: EventRow): PublicEvent {
  return {
    id: row.id,
    amount: row.amount,
    contributor: row.contributor,
    note: row.note,
    createdAt: row.created_at,
    localDay: row.local_day,
  };
}

function toPublicEntry(row: EntryRow, allocations: AllocationRow[]): PublicEntry {
  return {
    id: row.id,
    totalAmount: row.total_amount,
    note: row.note,
    createdAt: row.created_at,
    localDay: row.local_day,
    isCorrection: row.total_amount < 0,
    isGroup: row.allocation_count > 1,
    allocations: allocations.map((allocation) => ({
      id: allocation.id,
      contributor: allocation.contributor,
      amount: allocation.amount,
    })),
  };
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
      `SELECT id, idempotency_key, total_amount, note, allocation_count, created_at, local_day
       FROM beer_entries WHERE idempotency_key = ?`,
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
      `SELECT total, event_count, entry_count, updated_at
       FROM challenge_state WHERE id = 1`,
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
    entry: toPublicEntry(existing.row, existing.allocations),
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
  const existing = await readEntryByIdempotency(env.DB, input.idempotencyKey);
  if (existing) return existingEntryResult(env, existing, input);

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
    env.DB.prepare(
      `INSERT INTO beer_entries
       (id, idempotency_key, total_amount, note, allocation_count, created_at, local_day, session_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
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
      env.DB.prepare(
        `INSERT INTO beer_events
         (id, idempotency_key, amount, contributor, contributor_key, note, created_at, local_day,
          session_fingerprint, entry_id, allocation_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
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
    env.DB.prepare(
      `UPDATE challenge_state
       SET total = total + ?,
           event_count = event_count + ?,
           entry_count = entry_count + 1,
           updated_at = ?
       WHERE id = 1
       RETURNING total, event_count, entry_count, updated_at`,
    ).bind(input.totalAmount, allocationRows.length, nowMs),
    ...allocationRows.map((allocation) =>
      env.DB.prepare(
        `INSERT INTO contributor_totals
         (contributor_key, display_name, net_total, event_count, updated_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(contributor_key) DO UPDATE SET
           display_name = excluded.display_name,
           net_total = contributor_totals.net_total + excluded.net_total,
           event_count = contributor_totals.event_count + 1,
           updated_at = excluded.updated_at`,
      ).bind(allocation.contributorKey, allocation.contributor, allocation.amount, nowMs),
    ),
    env.DB.prepare(
      `INSERT INTO daily_totals
       (local_day, net_total, event_count, entry_count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(local_day) DO UPDATE SET
         net_total = daily_totals.net_total + excluded.net_total,
         event_count = daily_totals.event_count + excluded.event_count,
         entry_count = daily_totals.entry_count + 1,
         updated_at = excluded.updated_at`,
    ).bind(localDay, input.totalAmount, allocationRows.length, nowMs),
  ];
  const stateResultIndex = 1 + allocationRows.length;

  try {
    const results = await env.DB.batch(statements);
    const stateRows = results[stateResultIndex]?.results as StateRow[] | undefined;
    const state = stateRows?.[0];
    if (!state) throw new Error('Aggregate update did not return challenge state');
    const publicAllocations: PublicAllocation[] = allocationRows.map((allocation) => ({
      id: allocation.id,
      contributor: allocation.contributor,
      amount: allocation.amount,
    }));
    return {
      entry: {
        id: entryId,
        totalAmount: input.totalAmount,
        note: input.note,
        createdAt: nowMs,
        localDay,
        isCorrection: input.totalAmount < 0,
        isGroup: publicAllocations.length > 1,
        allocations: publicAllocations,
      },
      stats: publicStats(env, state),
      idempotent: false,
    };
  } catch {
    // A concurrent request may have won the unique parent-key race. Start a
    // primary-anchored session so the winner is visible before deciding whether
    // this is an exact retry or a conflicting key reuse.
    const session = env.DB.withSession('first-primary');
    const concurrent = await readEntryByIdempotency(session, input.idempotencyKey);
    if (concurrent) return existingEntryResult(env, concurrent, input, session);
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

function groupRecentEntries(rows: RecentEntryRow[]): PublicEntry[] {
  const grouped = new Map<string, PublicEntry>();
  for (const row of rows) {
    let entry = grouped.get(row.entry_id);
    if (!entry) {
      entry = {
        id: row.entry_id,
        totalAmount: row.total_amount,
        note: row.entry_note,
        createdAt: row.entry_created_at,
        localDay: row.entry_local_day,
        isCorrection: row.total_amount < 0,
        isGroup: row.allocation_count > 1,
        allocations: [],
      };
      grouped.set(row.entry_id, entry);
    }
    entry.allocations.push({
      id: row.allocation_id,
      contributor: row.contributor,
      amount: row.allocation_amount,
    });
  }
  return [...grouped.values()];
}

export async function getSummary(env: Env, nowMs = Date.now()): Promise<unknown> {
  const target = Number(env.CHALLENGE_TARGET);
  const days = recentCalendarDays(nowMs, env.CHALLENGE_TIMEZONE);
  const primarySummaryQuery = Promise.all([
    readState(env.DB),
    env.DB.prepare(
      `SELECT id, amount, contributor, note, created_at, local_day
       FROM beer_events ORDER BY created_at DESC, allocation_index ASC LIMIT ?`,
    )
      .bind(25)
      .all<EventRow>(),
    env.DB.prepare(
      `WITH latest_entries AS (
         SELECT id, total_amount, note, allocation_count, created_at, local_day
         FROM beer_entries
         ORDER BY created_at DESC, id DESC
         LIMIT ?
       )
       SELECT
         latest_entries.id AS entry_id,
         latest_entries.total_amount,
         latest_entries.note AS entry_note,
         latest_entries.created_at AS entry_created_at,
         latest_entries.local_day AS entry_local_day,
         latest_entries.allocation_count,
         beer_events.id AS allocation_id,
         beer_events.amount AS allocation_amount,
         beer_events.contributor,
         beer_events.allocation_index
       FROM latest_entries
       JOIN beer_events ON beer_events.entry_id = latest_entries.id
       ORDER BY latest_entries.created_at DESC, latest_entries.id DESC, beer_events.allocation_index ASC`,
    )
      .bind(25)
      .all<RecentEntryRow>(),
    env.DB.prepare(
      `SELECT display_name, net_total, event_count
       FROM contributor_totals
       ORDER BY net_total DESC, updated_at ASC
       LIMIT ?`,
    )
      .bind(10)
      .all<{ display_name: string; net_total: number; event_count: number }>(),
    env.DB.prepare(
      `SELECT local_day, net_total, event_count, entry_count
       FROM daily_totals WHERE local_day >= ? ORDER BY local_day ASC`,
    )
      .bind(days[0])
      .all<{
        local_day: string;
        net_total: number;
        event_count: number;
        entry_count: number;
      }>(),
  ]);
  const crewSizeQuery = env.DB.prepare(
    `SELECT COUNT(DISTINCT contributor_key) AS crew_size
       FROM beer_events
       WHERE amount > 0
         AND contributor_key IS NOT NULL
         AND contributor_key <> ''
         AND contributor_key <> ?`,
  )
    .bind(normalizeContributorKey(ANONYMOUS_CONTRIBUTOR))
    .first<CrewSizeRow>();
  const [[state, recentEvents, recentEntryRows, leaderboard, daily], crewSizeRow] =
    await Promise.all([primarySummaryQuery, crewSizeQuery]);

  const total = state.total;
  const dailyMap = new Map(daily.results.map((row) => [row.local_day, row]));
  return {
    challenge: {
      target,
      startAt: env.CHALLENGE_START_ISO,
      deadlineAt: env.CHALLENGE_DEADLINE_ISO,
      timezone: env.CHALLENGE_TIMEZONE,
    },
    stats: {
      total,
      remaining: Math.max(0, target - total),
      eventCount: state.entry_count,
      entryCount: state.entry_count,
      allocationCount: state.event_count,
      crewSize: toNonNegativeInteger(crewSizeRow?.crew_size),
      percentComplete: target > 0 ? Math.min(100, (total / target) * 100) : 100,
      updatedAt: state.updated_at,
    },
    recentEntries: groupRecentEntries(recentEntryRows.results),
    recentEvents: recentEvents.results.map(toPublicEvent),
    leaderboard: leaderboard.results.map((row) => ({
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
