import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { createBeerEntry } from '../src/database';
import { recordedMilestones } from '../src/milestones';
import { parseEntryBody } from '../src/schemas';

it('uses completed recorded-day closes, preserves downward corrections, and never invents today’s closing milestone', async () => {
  const originalDays = await env.DB.prepare('SELECT * FROM daily_totals ORDER BY local_day').all();
  // Test storage is isolated per file. Existing setup has no fixture ledger.
  expect(originalDays.results).toHaveLength(0);
  for (const [amount, date] of [
    [90, '2026-08-01T18:00:00-07:00'],
    [30, '2026-08-02T18:00:00-07:00'],
    [-40, '2026-08-02T19:00:00-07:00'],
    [25, '2026-08-03T18:00:00-07:00'],
    [250, '2026-08-04T18:00:00-07:00'],
    [250, '2026-08-04T19:00:00-07:00'],
  ] as const) {
    await createBeerEntry(
      env,
      parseEntryBody({
        totalAmount: amount,
        allocations: [{ contributor: 'Synthetic milestone', amount }],
        note: amount < 0 ? 'Synthetic correction' : null,
        idempotencyKey: crypto.randomUUID(),
      }),
      'synthetic',
      Date.parse(date),
    );
  }
  const result = await recordedMilestones(env.DB, env, Date.parse('2026-08-04T20:00:00-07:00'));
  expect(result.milestones).toEqual([
    { amount: 100, recordedDay: '2026-08-03', closingTotal: 105 },
  ]);
  const nextDay = await recordedMilestones(env.DB, env, Date.parse('2026-08-05T00:00:00-07:00'));
  expect(nextDay.milestones).toEqual([
    { amount: 100, recordedDay: '2026-08-03', closingTotal: 105 },
    { amount: 500, recordedDay: '2026-08-04', closingTotal: 605 },
  ]);
  expect(await env.DB.prepare('SELECT total FROM challenge_state WHERE id=1').first()).toEqual({
    total: 605,
  });
});
