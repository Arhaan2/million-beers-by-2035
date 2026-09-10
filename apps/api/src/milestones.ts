import type { Database } from './crew';
import { localDayFromTimestamp } from './database';

// The daily aggregate has a reliable calendar order; original within-day write
// ordering is unavailable. Only completed recorded days can establish a close.
export async function recordedMilestones(database: Database, env: Env, now = Date.now()) {
  const target = Number(env.CHALLENGE_TARGET);
  const thresholds = [
    ...new Set([
      100,
      500,
      1_000,
      5_000,
      10_000,
      25_000,
      50_000,
      100_000,
      250_000,
      500_000,
      750_000,
      target,
    ]),
  ]
    .filter((amount) => amount > 0 && amount <= target)
    .sort((a, b) => a - b);
  const today = localDayFromTimestamp(now, env.CHALLENGE_TIMEZONE);
  const result = await database
    .prepare(
      `
    WITH thresholds(amount) AS (VALUES ${thresholds.map(() => '(?)').join(',')}),
    closing_days AS (
      SELECT local_day, SUM(net_total) OVER (ORDER BY local_day ROWS UNBOUNDED PRECEDING) AS closing_total
      FROM daily_totals WHERE local_day < ?
    ), reached AS (
      SELECT t.amount, MIN(d.local_day) AS recorded_day
      FROM thresholds t JOIN closing_days d ON d.closing_total >= t.amount GROUP BY t.amount
    )
    SELECT r.amount, r.recorded_day AS recordedDay, d.closing_total AS closingTotal
    FROM reached r JOIN closing_days d ON d.local_day = r.recorded_day ORDER BY r.amount
  `,
    )
    .bind(...thresholds, today)
    .all<{ amount: number; recordedDay: string; closingTotal: number }>();
  return {
    dateBasis: 'recorded-day-close' as const,
    limitation:
      'First completed recorded day ending at or above each milestone. Intraday crossing times are unknown; today is excluded.',
    milestones: result.results,
  };
}
