import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src';
import { createSessionToken } from '../src/auth';
import { createBeerEntry } from '../src/database';
import { parseEntryBody } from '../src/schemas';
import type { CreateEntryResult, PublicEntry } from '../src/types';

let address = 100;
let editorToken: string;
async function call(path: string, method = 'GET', body?: unknown, token = editorToken) {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com${path}`, {
      method,
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': `192.0.2.${address++}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    totalAmount: 5,
    allocations: [
      { contributor: 'Synthetic A', amount: 3 },
      { contributor: 'Synthetic B', amount: 2 },
    ],
    note: 'Synthetic gathering',
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

async function save(input = body()): Promise<CreateEntryResult> {
  const response = await call('/api/entries', 'POST', input);
  expect(response.status).toBe(201);
  return response.json<CreateEntryResult>();
}

function correction(
  source: PublicEntry,
  sourceIndex = 0,
  amount = 2,
  overrides: Record<string, unknown> = {},
) {
  return body({
    totalAmount: -amount,
    note: 'Synthetic linked correction',
    correctionOfEntryId: source.id,
    allocations: [
      {
        contributor: 'Ignored client label',
        amount: -amount,
        sourceAllocationId: source.allocations[sourceIndex]?.id,
      },
    ],
    ...overrides,
  });
}

async function assertTotals(total: number, entries: number, allocations: number) {
  expect(
    await env.DB.prepare(
      `SELECT total,event_count,entry_count FROM challenge_state WHERE id=1`,
    ).first(),
  ).toEqual({ total, event_count: allocations, entry_count: entries });
  expect(
    await env.DB.prepare(
      `SELECT (SELECT SUM(total_amount) FROM beer_entries) AS parents,
    (SELECT SUM(amount) FROM beer_events) AS children,(SELECT SUM(net_total) FROM contributor_totals) AS contributors,
    (SELECT SUM(net_total) FROM daily_totals) AS days`,
    ).first(),
  ).toEqual({ parents: total, children: total, contributors: total, days: total });
  expect(
    await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM beer_entries p WHERE
    p.total_amount<>(SELECT SUM(amount) FROM beer_events e WHERE e.entry_id=p.id)
    OR p.allocation_count<>(SELECT COUNT(*) FROM beer_events e WHERE e.entry_id=p.id)`,
    ).first(),
  ).toEqual({ count: 0 });
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM beer_events'),
    env.DB.prepare('DELETE FROM beer_entries'),
    env.DB.prepare('DELETE FROM contributor_totals'),
    env.DB.prepare('DELETE FROM daily_totals'),
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare(
      'UPDATE challenge_state SET total=0,event_count=0,entry_count=0,updated_at=0 WHERE id=1',
    ),
  ]);
  editorToken = (await createSessionToken(env.SESSION_SIGNING_SECRET, 3600)).token;
});

describe('crew extensions on the actual Worker and D1 transaction path', () => {
  it('serves no-store revisioned summary and independent liveness/readiness capabilities', async () => {
    expect((await call('/health')).status).toBe(200);
    const ready = await call('/ready');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      ok: true,
      schemaVersion: 3,
      capabilities: { photos: false, strongIdentity: false, linkedCorrections: true },
    });
    const saved = await save();
    const response = await call('/api/summary');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toMatchObject({
      revision: saved.stats.revision,
      stats: { total: 5 },
    });
  });

  it('keeps old single/group and correction contracts usable with enhanced capabilities disabled', async () => {
    const enhanced = body({ memory: { title: 'Saved before disable' } });
    await save(enhanced);
    await env.DB.prepare('UPDATE upgrade_state SET mutations_enabled=0 WHERE id=1').run();
    expect((await call('/api/entries', 'POST', enhanced)).status).toBe(200);
    expect(
      (await call('/api/entries', 'POST', body({ memory: { title: 'Disabled new memory' } })))
        .status,
    ).toBe(503);
    expect((await call('/api/members', 'POST', { displayName: 'Disabled creation' })).status).toBe(
      503,
    );
    const old = await call('/api/events', 'POST', {
      amount: 2,
      contributor: 'Legacy',
      note: 'Old cached client',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(old.status).toBe(201);
    expect(await old.json()).toMatchObject({
      total: 7,
      event: { amount: 2, contributor: 'Legacy' },
    });
    const adjustment = await save(
      body({
        totalAmount: -1,
        allocations: [{ contributor: 'Legacy', amount: -1 }],
        note: 'Legacy unlinked correction',
      }),
    );
    expect(adjustment.entry.correctionKind).toBe('legacy');
    await assertTotals(6, 3, 4);
  });

  it('reports readiness failure without conflating it with Worker liveness', async () => {
    const trigger = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='crew_correction_allocation'",
    ).first<{ sql: string }>();
    if (!trigger) throw new Error('Required trigger fixture is missing');
    await env.DB.prepare('DROP TRIGGER crew_correction_allocation').run();
    try {
      const ready = await call('/ready');
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({
        ok: false,
        capabilities: { linkedCorrections: false },
      });
      expect((await call('/health')).status).toBe(200);
    } finally {
      await env.DB.prepare(trigger.sql).run();
    }
  });

  it('keeps exact metadata retry identity after title edits and member renames', async () => {
    const input = body({ memory: { title: 'Original title', venue: 'Synthetic venue' } });
    const saved = await save(input);
    const rows = (await env.DB.prepare('SELECT * FROM beer_events ORDER BY id').all()).results;
    const edit = await call(`/api/entries/${saved.entry.id}/memory`, 'PUT', {
      expectedVersion: 0,
      memory: { title: 'Edited title' },
    });
    expect(edit.status).toBe(200);
    await env.DB.prepare('UPDATE crew_members SET display_name=? WHERE id=?')
      .bind('Renamed label', saved.entry.allocations[0]?.memberId)
      .run();
    expect((await call('/api/entries', 'POST', input)).status).toBe(200);
    expect(
      (await call('/api/entries', 'POST', { ...input, memory: { title: 'Edited title' } })).status,
    ).toBe(409);
    expect((await env.DB.prepare('SELECT * FROM beer_events ORDER BY id').all()).results).toEqual(
      rows,
    );
    await assertTotals(5, 1, 2);
  });

  it('includes stable member identity in idempotency equality and rejects alias duplicates', async () => {
    const saved = await save();
    const [first, second] = saved.entry.allocations;
    const input = body({
      allocations: [{ contributor: 'Same supplied text', memberId: first?.memberId, amount: 5 }],
    });
    await save(input);
    expect(
      (
        await call('/api/entries', 'POST', {
          ...input,
          allocations: [
            { contributor: 'Same supplied text', memberId: second?.memberId, amount: 5 },
          ],
        })
      ).status,
    ).toBe(409);
    await env.DB.prepare(
      'INSERT INTO member_aliases(alias_key,member_id,display_name) VALUES (?,?,?)',
    )
      .bind('synthetic alias', first?.memberId, 'Synthetic Alias')
      .run();
    const duplicate = body({
      allocations: [
        { contributor: 'Synthetic A', amount: 3 },
        { contributor: 'Synthetic Alias', amount: 2 },
      ],
    });
    expect((await call('/api/entries', 'POST', duplicate)).status).toBe(400);
    await assertTotals(10, 2, 3);
  });

  it('rejects concurrent partial corrections that exceed one allocation and never consumes allowance twice on retry', async () => {
    const source = (await save()).entry;
    const first = correction(source);
    const second = correction(source);
    const responses = await Promise.all([
      call('/api/entries', 'POST', first),
      call('/api/entries', 'POST', second),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const winner = responses[0]?.status === 201 ? first : second;
    const retries = await Promise.all([
      call('/api/entries', 'POST', winner),
      call('/api/entries', 'POST', winner),
    ]);
    expect(retries.map((response) => response.status)).toEqual([200, 200]);
    const details = await (
      await call(`/api/entries/${source.id}`)
    ).json<{ entry: PublicEntry; corrections: PublicEntry[] }>();
    expect(details.entry.allocations.map((allocation) => allocation.remainingCorrectable)).toEqual([
      1, 2,
    ]);
    expect(details.corrections).toHaveLength(1);
    expect(details.corrections[0]?.allocations[0]?.contributor).toBe('Synthetic A');
    await assertTotals(3, 2, 3);
  });

  it('accepts only one of two concurrent full reversals', async () => {
    const source = (await save()).entry;
    const full = () =>
      correction(source, 0, 5, {
        allocations: source.allocations.map((allocation) => ({
          sourceAllocationId: allocation.id,
          amount: -allocation.amount,
        })),
      });
    const responses = await Promise.all([
      call('/api/entries', 'POST', full()),
      call('/api/entries', 'POST', full()),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await assertTotals(0, 2, 4);
  });

  it('can reverse distinct historical allocations after an alias merge while rejecting a duplicate source allocation', async () => {
    const source = (await save()).entry;
    const firstId = source.allocations[0]?.memberId;
    const secondId = source.allocations[1]?.memberId;
    await env.DB.batch([
      env.DB.prepare('UPDATE member_aliases SET member_id=? WHERE member_id=?').bind(
        secondId,
        firstId,
      ),
      env.DB.prepare('UPDATE allocation_members SET member_id=? WHERE member_id=?').bind(
        secondId,
        firstId,
      ),
      env.DB.prepare('UPDATE crew_members SET public_display=0 WHERE id=?').bind(firstId),
    ]);
    const duplicateSource = correction(source, 0, 2, {
      allocations: [
        { sourceAllocationId: source.allocations[0]?.id, amount: -1 },
        { sourceAllocationId: source.allocations[0]?.id, amount: -1 },
      ],
    });
    expect((await call('/api/entries', 'POST', duplicateSource)).status).toBe(400);
    const full = correction(source, 0, 5, {
      allocations: source.allocations.map((allocation) => ({
        sourceAllocationId: allocation.id,
        amount: -allocation.amount,
      })),
    });
    expect((await call('/api/entries', 'POST', full)).status).toBe(201);
    await assertTotals(0, 2, 4);
  });

  it('rejects incorrect correction sources and leaves every aggregate unchanged', async () => {
    const first = (await save()).entry;
    const second = (await save()).entry;
    expect(
      (
        await call(
          '/api/entries',
          'POST',
          correction(first, 0, 1, {
            allocations: [{ sourceAllocationId: second.allocations[0]?.id, amount: -1 }],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          '/api/entries',
          'POST',
          correction(first, 0, 1, { correctionOfEntryId: 'nonexistent' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          '/api/entries',
          'POST',
          correction(first, 0, 1, {
            totalAmount: 1,
            allocations: [{ sourceAllocationId: first.allocations[0]?.id, amount: 1 }],
          }),
        )
      ).status,
    ).toBe(400);
    await assertTotals(10, 2, 4);
  });

  it('rolls back ledger, mappings and revision when new metadata fails within a transaction', async () => {
    await env.DB.prepare(
      `CREATE TRIGGER synthetic_metadata_failure BEFORE INSERT ON entry_metadata BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`,
    ).run();
    try {
      expect(
        (await call('/api/entries', 'POST', body({ memory: { title: 'Failure injection' } })))
          .status,
      ).toBe(500);
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM beer_entries').first()).toEqual({
        count: 0,
      });
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM crew_members').first()).toEqual({
        count: 0,
      });
      expect(await env.DB.prepare('SELECT revision FROM upgrade_state').first()).toEqual({
        revision: 0,
      });
      expect(
        await env.DB.prepare('SELECT total,event_count,entry_count FROM challenge_state').first(),
      ).toEqual({ total: 0, event_count: 0, entry_count: 0 });
    } finally {
      await env.DB.prepare('DROP TRIGGER synthetic_metadata_failure').run();
    }
  });

  it('redacts hidden members and private text across summary, legacy mutation, details, filters, member views and recaps', async () => {
    const input = body({
      note: 'Do not reveal this legacy note',
      memory: {
        title: 'Private memory title',
        venue: 'Private venue',
        brewery: 'Private brewery',
        visibility: 'private',
      },
    });
    const saved = await save(input);
    const memberId = saved.entry.allocations[0]?.memberId;
    await env.DB.prepare('UPDATE crew_members SET public_display=0 WHERE id=?')
      .bind(memberId)
      .run();
    const paths = [
      '/api/summary',
      '/api/entries',
      `/api/entries/${saved.entry.id}`,
      `/api/recaps?period=${saved.entry.localDay.slice(0, 7)}`,
      '/api/members',
    ];
    for (const path of paths) {
      const response = await call(path);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toMatch(
        /Synthetic A|Do not reveal this legacy note|Private memory title|Private venue|Private brewery|idempotency_key|session_fingerprint|alias_key|contributor_key/u,
      );
    }
    expect((await call(`/api/members/${memberId}`)).status).toBe(404);
    for (const filter of ['q=Private', 'venue=Private', 'brewery=Private']) {
      expect(await (await call(`/api/entries?${filter}`)).json()).toMatchObject({ entries: [] });
    }
    const retry = await call('/api/entries', 'POST', input);
    expect(retry.status).toBe(200);
    expect(await retry.text()).not.toMatch(
      /Synthetic A|Do not reveal this legacy note|Private memory title/u,
    );
    const legacy = await call('/api/events', 'POST', {
      contributor: 'Synthetic A',
      amount: 1,
      note: 'Hidden new note',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(legacy.status).toBe(201);
    expect(await legacy.text()).not.toMatch(/Synthetic A|Hidden new note/u);
  });

  it('keeps private memory editing and owner administration unavailable to shared-code sessions', async () => {
    const entry = (await save(body({ memory: { title: 'Private title', visibility: 'private' } })))
      .entry;
    expect(
      (
        await call(`/api/entries/${entry.id}/memory`, 'PUT', {
          expectedVersion: 0,
          memory: { title: 'Publish this' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('/api/admin/members', 'POST', {
          memberId: entry.allocations[0]?.memberId,
          publicDisplay: true,
        })
      ).status,
    ).toBe(404);
    expect((await call('/api/members', 'POST', { displayName: 'Not authorized' }, '')).status).toBe(
      401,
    );
  });

  it('rejects ignored privacy preferences when creating a new member', async () => {
    expect(
      (
        await call('/api/members', 'POST', {
          displayName: 'Private requested',
          publicDisplay: false,
        })
      ).status,
    ).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM crew_members').first()).toEqual({
      count: 0,
    });
  });

  it('retains privacy, new history and old-client writes under the compatible rollback capability setting', async () => {
    const source = (
      await save(
        body({
          memory: { title: 'Secret rollback memory', visibility: 'private' },
          occurredAt: '2026-07-24T00:00:00-07:00',
          occurrenceTimezone: 'America/Los_Angeles',
          occurrencePrecision: 'day',
        }),
      )
    ).entry;
    await save(correction(source, 0, 1));
    await env.DB.prepare('UPDATE crew_members SET public_display=0 WHERE id=?')
      .bind(source.allocations[0]?.memberId)
      .run();
    await env.DB.prepare('UPDATE upgrade_state SET mutations_enabled=0 WHERE id=1').run();
    const detail = await call(`/api/entries/${source.id}`);
    expect(detail.status).toBe(200);
    const data = await detail.json<{ entry: PublicEntry; corrections: PublicEntry[] }>();
    expect(data.entry).toMatchObject({ memory: null, occurredAt: null, occurrenceTimezone: null });
    expect(JSON.stringify(data)).not.toMatch(/Synthetic A|Secret rollback memory/u);
    expect(data.corrections).toHaveLength(1);
    expect((await call('/api/entries', 'POST', correction(source, 0, 1))).status).toBe(503);
    await save(
      body({
        totalAmount: 1,
        allocations: [{ contributor: 'Synthetic A', amount: 1 }],
        note: 'Old rollback client',
      }),
    );
    const summary = await call('/api/summary');
    expect(await summary.text()).not.toMatch(
      /Synthetic A|Secret rollback memory|Old rollback client/u,
    );
    await assertTotals(5, 3, 4);
  });

  it('uses optimistic concurrency for metadata edits without recording quantities again', async () => {
    const entry = (await save()).entry;
    const edits = await Promise.all(
      ['First title', 'Second title'].map((title) =>
        call(`/api/entries/${entry.id}/memory`, 'PUT', { expectedVersion: 0, memory: { title } }),
      ),
    );
    expect(edits.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM projection_audit WHERE action='memory_edit'",
      ).first(),
    ).toEqual({ count: 1 });
    await assertTotals(5, 1, 2);
  });

  it('keeps named source counts separate from exact-ID system classification and anonymous entries', async () => {
    const system = (
      await save(body({ allocations: [{ contributor: 'Production Smoke Test', amount: 5 }] }))
    ).entry;
    await save(body({ allocations: [{ contributor: 'Anonymous', amount: 5 }] }));
    await env.DB.prepare(
      'INSERT INTO entry_classification(entry_id,is_system,evidence) VALUES (?,1,?)',
    )
      .bind(system.id, 'Synthetic exact-ID verification evidence')
      .run();
    const summary = await (
      await call('/api/summary')
    ).json<{ stats: Record<string, number>; community: Record<string, number> }>();
    expect(summary.stats).toMatchObject({ total: 10, entryCount: 2, crewSize: 1 });
    expect(summary.community).toMatchObject({ namedContributors: 0, entryCount: 1 });
    const directory = await (
      await call('/api/members')
    ).json<{ members: Array<{ participationCount: number }> }>();
    expect(directory.members[0]?.participationCount).toBe(0);
    await assertTotals(10, 2, 2);
  });

  it('preserves occurrence precision and recorded-day totals while searching happened-on dates', async () => {
    const saved = await save(
      body({
        occurredAt: '2026-07-24T00:00:00-07:00',
        occurrenceTimezone: 'America/Los_Angeles',
        occurrencePrecision: 'day',
      }),
    );
    expect(saved.entry).toMatchObject({
      occurredAt: '2026-07-24T07:00:00.000Z',
      occurrencePrecision: 'day',
      occurrenceSource: 'provided',
    });
    const page = await (
      await call('/api/entries?dateBasis=occurred&from=2026-07-24&to=2026-07-24')
    ).json<{ entries: PublicEntry[] }>();
    expect(page.entries.map((entry) => entry.id)).toEqual([saved.entry.id]);
    expect(await env.DB.prepare('SELECT local_day,net_total FROM daily_totals').first()).toEqual({
      local_day: saved.entry.localDay,
      net_total: 5,
    });
  });

  it('shows on-this-date memories only for known public occurrence dates and excludes operational records', async () => {
    await createBeerEntry(
      env,
      parseEntryBody(body()),
      'synthetic-test',
      Date.parse('2026-07-24T12:00:00Z'),
    );
    const occurrence = {
      occurredAt: '2026-07-24T00:00:00-07:00',
      occurrenceTimezone: 'America/Los_Angeles',
      occurrencePrecision: 'day',
    };
    const known = (await save(body({ ...occurrence, memory: { title: 'Public known date' } })))
      .entry;
    await save(
      body({ ...occurrence, memory: { title: 'Private known date', visibility: 'private' } }),
    );
    const system = (
      await save(body({ ...occurrence, memory: { title: 'Operational known date' } }))
    ).entry;
    await env.DB.prepare(
      'INSERT INTO entry_classification(entry_id,is_system,evidence) VALUES (?,1,?)',
    )
      .bind(system.id, 'Synthetic exact-ID evidence')
      .run();
    const page = await (
      await call('/api/memories/on-this-date?monthDay=07-24')
    ).json<{ dateBasis: string; entries: PublicEntry[] }>();
    expect(page.dateBasis).toBe('occurred');
    expect(page.entries.map((entry) => entry.id)).toEqual([known.id]);
    expect((await call('/api/memories/on-this-date?monthDay=02-30')).status).toBe(400);
  });

  it('rejects normalized-name expansion and intentional Anonymous member creation before database insertion', async () => {
    expect((await call('/api/members', 'POST', { displayName: 'Anonymous' })).status).toBe(400);
    expect((await call('/api/members', 'POST', { displayName: 'ﬃ'.repeat(11) })).status).toBe(400);
    expect(
      (
        await call(
          '/api/entries',
          'POST',
          body({ allocations: [{ contributor: 'ﬃ'.repeat(11), amount: 5 }] }),
        )
      ).status,
    ).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM beer_entries').first()).toEqual({
      count: 0,
    });
  });

  it.each([
    { occurredAt: '2026-02-30T00:00:00Z', occurrenceTimezone: 'UTC' },
    { occurredAt: '2026-03-08T02:30:00-08:00', occurrenceTimezone: 'America/Los_Angeles' },
    { occurredAt: '2026-07-24T12:30:00Z', occurrenceTimezone: 'America/Los_Angeles' },
    { occurredAt: '2026-07-24T12:30:00', occurrenceTimezone: 'UTC' },
    { occurredAt: '2026-07-24T00:00:00Z', occurrenceTimezone: 'Invalid/Zone' },
    { occurredAt: '2026-07-24T12:30:00Z', occurrenceTimezone: 'UTC', occurrencePrecision: 'day' },
    { memory: { title: 'x'.repeat(81) } },
    { memory: { photoUrl: 'https://example.com/untrusted.png' } },
  ])('rejects invalid occurrence or metadata %# before a write', async (extension) => {
    expect((await call('/api/entries', 'POST', body(extension))).status).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM beer_entries').first()).toEqual({
      count: 0,
    });
  });

  it('retains an exact retry after session expiry and reauthentication', async () => {
    const input = body({ memory: { title: 'Commit occurred before response loss' } });
    await save(input);
    const expired = (
      await createSessionToken(env.SESSION_SIGNING_SECRET, 1, Math.floor(Date.now() / 1000) - 60)
    ).token;
    expect((await call('/api/entries', 'POST', input, expired)).status).toBe(401);
    expect((await call('/api/entries', 'POST', input)).status).toBe(200);
    await assertTotals(5, 1, 2);
  });

  it('paginates large tied-timestamp history without gaps and selects members beyond the leaderboard', async () => {
    const timestamp = Date.parse('2026-08-01T12:00:00Z');
    for (let index = 0; index < 61; index += 1) {
      await createBeerEntry(
        env,
        parseEntryBody(
          body({
            totalAmount: 1,
            allocations: [{ contributor: `Synthetic ${index}`, amount: 1 }],
            memory: { title: `Gathering ${index}`, venue: 'Same venue' },
          }),
        ),
        'synthetic-test',
        timestamp,
      );
    }
    const identifiers: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { entries: PublicEntry[]; nextCursor: string | null } = await (
        await call(`/api/entries?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      ).json();
      identifiers.push(...page.entries.map((entry) => entry.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(identifiers).toHaveLength(61);
    expect(new Set(identifiers).size).toBe(61);
    expect(identifiers).toEqual([...identifiers].sort().reverse());
    const outside = await (
      await call('/api/members?q=Synthetic%2060')
    ).json<{ members: Array<{ id: string; displayName: string }> }>();
    expect(outside.members[0]?.displayName).toBe('Synthetic 60');
    const memberId = outside.members[0]?.id;
    expect((await call(`/api/entries?memberId=${memberId}`)).status).toBe(200);
    await save(
      body({ totalAmount: 1, allocations: [{ memberId, contributor: 'Synthetic 60', amount: 1 }] }),
    );
    expect((await call('/api/entries?limit=51')).status).toBe(400);
    expect((await call('/api/entries?cursor=invalid')).status).toBe(400);
    expect((await call('/api/entries?from=2026-02-30')).status).toBe(400);
    expect((await call('/api/entries?q=%27%20OR%201%3D1%20--')).status).toBe(200);
    await assertTotals(62, 62, 62);
  });
});
