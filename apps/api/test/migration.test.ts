import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('group entry migration', () => {
  it('preserves historical rows and promotes legacy-window inserts', async () => {
    await applyD1Migrations(env.MIGRATION_DB, env.TEST_INITIAL_MIGRATION);
    await env.MIGRATION_DB.batch([
      env.MIGRATION_DB.prepare(
        `INSERT INTO beer_events
         (id, idempotency_key, amount, contributor, contributor_key, note, created_at, local_day,
          session_fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        'old-a',
        crypto.randomUUID(),
        4,
        'Arhaan',
        'arhaan',
        'First note',
        1000,
        '2026-07-24',
        'fp-a',
      ),
      env.MIGRATION_DB.prepare(
        `INSERT INTO beer_events
         (id, idempotency_key, amount, contributor, contributor_key, note, created_at, local_day,
          session_fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        'old-b',
        crypto.randomUUID(),
        -1,
        'Sam',
        'sam',
        'Old correction',
        2000,
        '2026-07-25',
        'fp-b',
      ),
      env.MIGRATION_DB.prepare(
        'UPDATE challenge_state SET total = 3, event_count = 2, updated_at = 2000 WHERE id = 1',
      ),
      env.MIGRATION_DB.prepare(
        `INSERT INTO contributor_totals
         (contributor_key, display_name, net_total, event_count, updated_at)
         VALUES ('arhaan', 'Arhaan', 4, 1, 1000), ('sam', 'Sam', -1, 1, 2000)`,
      ),
      env.MIGRATION_DB.prepare(
        `INSERT INTO daily_totals (local_day, net_total, event_count, updated_at)
         VALUES ('2026-07-24', 4, 1, 1000), ('2026-07-25', -1, 1, 2000)`,
      ),
    ]);

    const before = {
      state: await env.MIGRATION_DB.prepare(
        'SELECT total, event_count FROM challenge_state',
      ).first(),
      allocationSum: await env.MIGRATION_DB.prepare(
        'SELECT sum(amount) AS total FROM beer_events',
      ).first(),
      contributorSum: await env.MIGRATION_DB.prepare(
        'SELECT sum(net_total) AS total FROM contributor_totals',
      ).first(),
    };

    await applyD1Migrations(env.MIGRATION_DB, env.TEST_GROUP_MIGRATION);

    expect(
      await env.MIGRATION_DB.prepare(
        `SELECT id, total_amount, note, allocation_count, created_at, local_day
         FROM beer_entries ORDER BY created_at`,
      ).all(),
    ).toMatchObject({
      results: [
        {
          id: 'legacy-old-a',
          total_amount: 4,
          note: 'First note',
          allocation_count: 1,
          created_at: 1000,
          local_day: '2026-07-24',
        },
        {
          id: 'legacy-old-b',
          total_amount: -1,
          note: 'Old correction',
          allocation_count: 1,
          created_at: 2000,
          local_day: '2026-07-25',
        },
      ],
    });
    expect(
      await env.MIGRATION_DB.prepare(
        'SELECT id, entry_id, allocation_index FROM beer_events ORDER BY created_at',
      ).all(),
    ).toMatchObject({
      results: [
        { id: 'old-a', entry_id: 'legacy-old-a', allocation_index: 0 },
        { id: 'old-b', entry_id: 'legacy-old-b', allocation_index: 0 },
      ],
    });
    expect(
      await env.MIGRATION_DB.prepare(
        'SELECT total, event_count, entry_count FROM challenge_state',
      ).first(),
    ).toEqual({ total: 3, event_count: 2, entry_count: 2 });
    expect(
      await env.MIGRATION_DB.prepare('SELECT count(*) AS count FROM beer_entries').first(),
    ).toEqual({ count: 2 });
    expect(
      await env.MIGRATION_DB.prepare('SELECT sum(amount) AS total FROM beer_events').first(),
    ).toEqual(before.allocationSum);
    expect(
      await env.MIGRATION_DB.prepare(
        'SELECT sum(net_total) AS total FROM contributor_totals',
      ).first(),
    ).toEqual(before.contributorSum);
    expect(before.state).toEqual({ total: 3, event_count: 2 });

    const legacyKey = crypto.randomUUID();
    await env.MIGRATION_DB.batch([
      env.MIGRATION_DB.prepare(
        `INSERT INTO beer_events
         (id, idempotency_key, amount, contributor, contributor_key, note, created_at, local_day,
          session_fingerprint)
         VALUES (?, ?, 2, 'Legacy Window', 'legacy window', 'Window insert', 3000, '2026-07-26', 'fp-c')`,
      ).bind('old-worker-c', legacyKey),
      env.MIGRATION_DB.prepare(
        `UPDATE challenge_state
         SET total = total + 2, event_count = event_count + 1, updated_at = 3000 WHERE id = 1`,
      ),
      env.MIGRATION_DB.prepare(
        `INSERT INTO contributor_totals
         (contributor_key, display_name, net_total, event_count, updated_at)
         VALUES ('legacy window', 'Legacy Window', 2, 1, 3000)`,
      ),
      env.MIGRATION_DB.prepare(
        `INSERT INTO daily_totals (local_day, net_total, event_count, updated_at)
         VALUES ('2026-07-26', 2, 1, 3000)
         ON CONFLICT(local_day) DO UPDATE SET
           net_total = daily_totals.net_total + 2,
           event_count = daily_totals.event_count + 1,
           updated_at = 3000`,
      ),
    ]);

    expect(
      await env.MIGRATION_DB.prepare(
        'SELECT entry_id, allocation_index FROM beer_events WHERE id = ?',
      )
        .bind('old-worker-c')
        .first(),
    ).toEqual({ entry_id: 'legacy-old-worker-c', allocation_index: 0 });
    expect(
      await env.MIGRATION_DB.prepare(
        'SELECT total_amount, allocation_count FROM beer_entries WHERE idempotency_key = ?',
      )
        .bind(legacyKey)
        .first(),
    ).toEqual({ total_amount: 2, allocation_count: 1 });
    expect(
      await env.MIGRATION_DB.prepare(
        'SELECT total, event_count, entry_count FROM challenge_state',
      ).first(),
    ).toEqual({ total: 5, event_count: 3, entry_count: 3 });
    expect(
      await env.MIGRATION_DB.prepare(
        'SELECT net_total, event_count, entry_count FROM daily_totals WHERE local_day = ?',
      )
        .bind('2026-07-26')
        .first(),
    ).toEqual({ net_total: 2, event_count: 1, entry_count: 1 });
  });
});
