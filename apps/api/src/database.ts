import { ApiError } from './responses';
import type { EventInput, PublicEvent, RecordEventResult } from './types';

interface EventRow {
  id: string;
  amount: number;
  contributor: string;
  note: string | null;
  created_at: number;
  local_day: string;
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

function normalizeContributorKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('en-US');
}

export async function recordEvent(
  env: Env,
  input: EventInput,
  sessionFingerprint: string,
  nowMs = Date.now(),
): Promise<RecordEventResult> {
  const eventId = crypto.randomUUID();
  const contributorKey = normalizeContributorKey(input.contributor);
  const localDay = localDayFromTimestamp(nowMs, env.CHALLENGE_TIMEZONE);
  const statements = [
    env.DB.prepare(
      `INSERT INTO beer_events
       (id, idempotency_key, amount, contributor, contributor_key, note, created_at, local_day, session_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      eventId,
      input.idempotencyKey,
      input.amount,
      input.contributor,
      contributorKey,
      input.note,
      nowMs,
      localDay,
      sessionFingerprint,
    ),
    env.DB.prepare(
      `UPDATE challenge_state
       SET total = total + ?, event_count = event_count + 1, updated_at = ?
       WHERE id = 1
       RETURNING total`,
    ).bind(input.amount, nowMs),
    env.DB.prepare(
      `INSERT INTO contributor_totals
       (contributor_key, display_name, net_total, event_count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(contributor_key) DO UPDATE SET
         display_name = excluded.display_name,
         net_total = contributor_totals.net_total + excluded.net_total,
         event_count = contributor_totals.event_count + 1,
         updated_at = excluded.updated_at`,
    ).bind(contributorKey, input.contributor, input.amount, nowMs),
    env.DB.prepare(
      `INSERT INTO daily_totals (local_day, net_total, event_count, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(local_day) DO UPDATE SET
         net_total = daily_totals.net_total + excluded.net_total,
         event_count = daily_totals.event_count + 1,
         updated_at = excluded.updated_at`,
    ).bind(localDay, input.amount, nowMs),
  ];

  try {
    const results = await env.DB.batch(statements);
    const stateRows = results[1]?.results as { total: number }[] | undefined;
    const total = stateRows?.[0]?.total;
    if (typeof total !== 'number') throw new Error('Aggregate update did not return a total');
    return {
      event: {
        id: eventId,
        amount: input.amount,
        contributor: input.contributor,
        note: input.note,
        createdAt: nowMs,
        localDay,
      },
      total,
      idempotent: false,
    };
  } catch {
    const existing = await env.DB.prepare(
      `SELECT id, amount, contributor, note, created_at, local_day
       FROM beer_events WHERE idempotency_key = ?`,
    )
      .bind(input.idempotencyKey)
      .first<EventRow>();
    if (existing) {
      const state = await env.DB.prepare('SELECT total FROM challenge_state WHERE id = 1').first<{
        total: number;
      }>();
      return { event: toPublicEvent(existing), total: state?.total ?? 0, idempotent: true };
    }
    if (input.amount < 0) {
      const state = await env.DB.prepare('SELECT total FROM challenge_state WHERE id = 1').first<{
        total: number;
      }>();
      if ((state?.total ?? 0) + input.amount < 0) {
        throw new ApiError(409, 'A correction cannot make the total negative.', 'negative_total');
      }
    }
    throw new ApiError(500, 'Unable to record the event.', 'database_write_failed');
  }
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
  const target = Number(env.CHALLENGE_TARGET);
  const days = recentCalendarDays(nowMs, env.CHALLENGE_TIMEZONE);
  const [state, recent, leaderboard, daily] = await Promise.all([
    env.DB.prepare('SELECT total, event_count, updated_at FROM challenge_state WHERE id = ?')
      .bind(1)
      .first<{ total: number; event_count: number; updated_at: number }>(),
    env.DB.prepare(
      `SELECT id, amount, contributor, note, created_at, local_day
       FROM beer_events ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(25)
      .all<EventRow>(),
    env.DB.prepare(
      `SELECT display_name, net_total, event_count
       FROM contributor_totals
       ORDER BY net_total DESC, updated_at ASC
       LIMIT ?`,
    )
      .bind(10)
      .all<{ display_name: string; net_total: number; event_count: number }>(),
    env.DB.prepare(
      `SELECT local_day, net_total, event_count
       FROM daily_totals WHERE local_day >= ? ORDER BY local_day ASC`,
    )
      .bind(days[0])
      .all<{ local_day: string; net_total: number; event_count: number }>(),
  ]);

  const total = state?.total ?? 0;
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
      eventCount: state?.event_count ?? 0,
      percentComplete: target > 0 ? Math.min(100, (total / target) * 100) : 100,
      updatedAt: state?.updated_at ?? 0,
    },
    recentEvents: recent.results.map(toPublicEvent),
    leaderboard: leaderboard.results.map((row) => ({
      contributor: row.display_name,
      netTotal: row.net_total,
      eventCount: row.event_count,
    })),
    dailyTotals: days.map((localDay) => {
      const row = dailyMap.get(localDay);
      return { localDay, netTotal: row?.net_total ?? 0, eventCount: row?.event_count ?? 0 };
    }),
  };
}
