import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

async function oldGroupWrite(database: D1Database, id: string, names: string[], amounts: number[]) {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  await database.batch([
    database
      .prepare(
        `INSERT INTO beer_entries
      (id,idempotency_key,total_amount,note,allocation_count,created_at,local_day,session_fingerprint)
      VALUES (?,?,?,'Synthetic migration fixture',?,1000,'2026-07-24','synthetic')`,
      )
      .bind(id, `key-${id}`, total, names.length),
    ...names.map((name, index) =>
      database
        .prepare(
          `INSERT INTO beer_events
      (id,idempotency_key,amount,contributor,contributor_key,note,created_at,local_day,session_fingerprint,entry_id,allocation_index)
      VALUES (?,?,?,?,?,'Synthetic migration fixture',1000,'2026-07-24','synthetic',?,?)`,
        )
        .bind(
          `${id}-${index}`,
          `key-${id}-${index}`,
          amounts[index],
          name,
          name.normalize('NFKC').toLocaleLowerCase('en-US'),
          id,
          index,
        ),
    ),
    database
      .prepare(
        `UPDATE challenge_state SET total=total+?,event_count=event_count+?,entry_count=entry_count+1,updated_at=1000 WHERE id=1`,
      )
      .bind(total, names.length),
    ...names.map((name, index) =>
      database
        .prepare(
          `INSERT INTO contributor_totals
      (contributor_key,display_name,net_total,event_count,updated_at) VALUES (?,?,?,1,1000)
      ON CONFLICT(contributor_key) DO UPDATE SET net_total=net_total+excluded.net_total,event_count=event_count+1`,
        )
        .bind(name.normalize('NFKC').toLocaleLowerCase('en-US'), name, amounts[index]),
    ),
    database
      .prepare(
        `INSERT INTO daily_totals (local_day,net_total,event_count,entry_count,updated_at)
      VALUES ('2026-07-24',?,?,1,1000) ON CONFLICT(local_day) DO UPDATE SET net_total=net_total+excluded.net_total,event_count=event_count+excluded.event_count,entry_count=entry_count+1`,
      )
      .bind(total, names.length),
  ]);
}

async function originalRows(database: D1Database) {
  return {
    parents: (
      await database
        .prepare(
          'SELECT id,idempotency_key,total_amount,note,allocation_count,created_at,local_day,session_fingerprint FROM beer_entries ORDER BY id',
        )
        .all()
    ).results,
    allocations: (
      await database
        .prepare(
          'SELECT id,idempotency_key,amount,contributor,contributor_key,note,created_at,local_day,session_fingerprint,entry_id,allocation_index FROM beer_events ORDER BY id',
        )
        .all()
    ).results,
    contributors: (
      await database.prepare('SELECT * FROM contributor_totals ORDER BY contributor_key').all()
    ).results,
    days: (await database.prepare('SELECT * FROM daily_totals ORDER BY local_day').all()).results,
    state: await database.prepare('SELECT * FROM challenge_state').first(),
  };
}

async function reconcile(database: D1Database) {
  expect(
    await database
      .prepare(
        `SELECT
    (SELECT total FROM challenge_state WHERE id=1) AS canonical,
    (SELECT sum(total_amount) FROM beer_entries) AS parents,
    (SELECT sum(amount) FROM beer_events) AS allocations,
    (SELECT sum(net_total) FROM contributor_totals) AS contributors,
    (SELECT sum(net_total) FROM daily_totals) AS days`,
      )
      .first(),
  ).toEqual({ canonical: 12, parents: 12, allocations: 12, contributors: 12, days: 12 });
  expect(
    await database
      .prepare(
        `SELECT COUNT(*) AS count FROM beer_entries p WHERE
    p.total_amount <> (SELECT sum(amount) FROM beer_events e WHERE e.entry_id=p.id)
    OR p.allocation_count <> (SELECT count(*) FROM beer_events e WHERE e.entry_id=p.id)`,
      )
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await database
      .prepare(
        `SELECT COUNT(*) AS count FROM beer_events e
    LEFT JOIN allocation_members am ON am.allocation_id=e.id
    WHERE e.contributor_key<>'anonymous' AND (am.member_id IS NULL OR am.entry_id<>e.entry_id)`,
      )
      .first(),
  ).toEqual({ count: 0 });
}

describe('additive crew projection migration', () => {
  it('preserves original fields, backfills deterministically and bridges both legacy write shapes with new mutations disabled', async () => {
    const database = env.CREW_MIGRATION_DB;
    await applyD1Migrations(database, [...env.TEST_INITIAL_MIGRATION, ...env.TEST_GROUP_MIGRATION]);
    await oldGroupWrite(database, 'before-group', ['Ａlice', 'Bob'], [3, 2]);
    await oldGroupWrite(database, 'before-repeat', ['alice'], [1]);
    await oldGroupWrite(database, 'before-anonymous', ['Anonymous'], [1]);
    const before = await originalRows(database);
    await applyD1Migrations(database, env.TEST_CREW_MIGRATION);
    expect(await originalRows(database)).toEqual(before);
    expect(
      await database.prepare('SELECT mutations_enabled,revision FROM upgrade_state').first(),
    ).toEqual({ mutations_enabled: 0, revision: 3 });
    expect(
      (
        await database
          .prepare('SELECT alias_key,member_id FROM member_aliases ORDER BY alias_key')
          .all()
      ).results,
    ).toEqual([
      { alias_key: 'alice', member_id: 'member-before-group-0' },
      { alias_key: 'bob', member_id: 'member-before-group-1' },
    ]);
    expect(
      await database.prepare('SELECT count(*) AS count FROM allocation_members').first(),
    ).toEqual({ count: 3 });
    // 0002 Worker: a parent plus allocations, unaware of every new side table.
    await oldGroupWrite(database, 'old-group-window', ['ALICE', 'Casey'], [2, 1]);
    // 0001 Worker: the original event-only transaction. The two AFTER triggers
    // must cooperate regardless of whether member mapping runs before promotion.
    await database.batch([
      database.prepare(`INSERT INTO beer_events (id,idempotency_key,amount,contributor,contributor_key,note,created_at,local_day,session_fingerprint)
        VALUES ('old-event-window','old-event-key',2,'Dee','dee','Synthetic legacy window',1000,'2026-07-24','synthetic')`),
      database.prepare(
        'UPDATE challenge_state SET total=total+2,event_count=event_count+1,updated_at=1000 WHERE id=1',
      ),
      database.prepare(`INSERT INTO contributor_totals VALUES ('dee','Dee',2,1,1000)`),
      database.prepare(
        `UPDATE daily_totals SET net_total=net_total+2,event_count=event_count+1 WHERE local_day='2026-07-24'`,
      ),
    ]);
    await reconcile(database);
    expect(
      await database.prepare('SELECT total,event_count,entry_count FROM challenge_state').first(),
    ).toEqual({ total: 12, event_count: 7, entry_count: 5 });
    expect(
      await database
        .prepare('SELECT member_id,entry_id FROM allocation_members WHERE allocation_id=?')
        .bind('old-event-window')
        .first(),
    ).toEqual({ member_id: 'member-old-event-window', entry_id: 'legacy-old-event-window' });
    expect(await database.prepare('SELECT revision FROM upgrade_state').first()).toEqual({
      revision: 5,
    });
    const complete = await originalRows(database);
    const mappings = (
      await database.prepare('SELECT * FROM allocation_members ORDER BY allocation_id').all()
    ).results;
    // Applied migrations are skipped; repeated invocation must not rerun backfill.
    await applyD1Migrations(database, [
      ...env.TEST_INITIAL_MIGRATION,
      ...env.TEST_GROUP_MIGRATION,
      ...env.TEST_CREW_MIGRATION,
    ]);
    expect(await originalRows(database)).toEqual(complete);
    expect(
      (await database.prepare('SELECT * FROM allocation_members ORDER BY allocation_id').all())
        .results,
    ).toEqual(mappings);
  });

  it('rolls back a failed migration as a unit and resumes only the pending migration', async () => {
    const database = env.FAILED_CREW_MIGRATION_DB;
    await applyD1Migrations(database, [...env.TEST_INITIAL_MIGRATION, ...env.TEST_GROUP_MIGRATION]);
    await oldGroupWrite(database, 'before-failure', ['Synthetic'], [2]);
    const before = await originalRows(database);
    const migration = env.TEST_CREW_MIGRATION[0];
    expect(migration).toBeDefined();
    if (!migration) throw new Error('Crew migration fixture missing');
    await expect(
      applyD1Migrations(database, [
        {
          ...migration,
          queries: [...migration.queries, 'SELECT missing_column FROM intentionally_missing_table'],
        },
      ]),
    ).rejects.toThrow();
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='upgrade_state'")
        .first(),
    ).toEqual({ count: 0 });
    expect(await originalRows(database)).toEqual(before);
    expect(await database.prepare('SELECT count(*) AS count FROM d1_migrations').first()).toEqual({
      count: 2,
    });
    await applyD1Migrations(database, env.TEST_CREW_MIGRATION);
    expect(await originalRows(database)).toEqual(before);
    expect(
      await database.prepare('SELECT count(*) AS count FROM allocation_members').first(),
    ).toEqual({ count: 1 });
    expect(await database.prepare('SELECT count(*) AS count FROM d1_migrations').first()).toEqual({
      count: 3,
    });
  });
});
