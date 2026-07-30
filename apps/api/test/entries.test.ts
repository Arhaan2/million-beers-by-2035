import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src';

const origin = 'http://localhost:5173';

async function call(
  path: string,
  init: RequestInit<IncomingRequestCfProperties> = {},
): Promise<Response> {
  const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
  const request = new IncomingRequest(`http://example.com${path}`, init);
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

async function token(): Promise<string> {
  const response = await call('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'CF-Connecting-IP': '192.0.2.30',
    },
    body: JSON.stringify({ code: 'test-crew-code' }),
  });
  return (await response.json<{ token: string }>()).token;
}

async function entry(
  editorToken: string,
  body: Record<string, unknown>,
  ip = '192.0.2.31',
): Promise<Response> {
  return call('/api/entries', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${editorToken}`,
      'Content-Type': 'application/json',
      Origin: origin,
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  });
}

function groupBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    totalAmount: 12,
    allocations: [
      { contributor: 'Person A', amount: 4 },
      { contributor: 'Person B', amount: 3 },
      { contributor: 'Person C', amount: 3 },
      { contributor: 'Person D', amount: 2 },
    ],
    note: 'Group hangout',
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM beer_events'),
    env.DB.prepare('DELETE FROM beer_entries'),
    env.DB.prepare('DELETE FROM contributor_totals'),
    env.DB.prepare('DELETE FROM daily_totals'),
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare(
      `UPDATE challenge_state
       SET total = 0, event_count = 0, entry_count = 0, updated_at = 0
       WHERE id = 1`,
    ),
  ]);
});

describe('group entries', () => {
  it('records a two-person entry as one update with two allocations', async () => {
    const response = await entry(await token(), {
      totalAmount: 5,
      allocations: [
        { contributor: 'Arhaan', amount: 3 },
        { contributor: 'Sam', amount: 2 },
      ],
      note: 'Two-person round',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      idempotent: false,
      entry: { totalAmount: 5, isGroup: true, isCorrection: false },
      stats: { total: 5, entryCount: 1, allocationCount: 2 },
    });
  });

  it('records an uneven four-person split and updates every aggregate independently', async () => {
    const response = await entry(await token(), groupBody());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      entry: {
        totalAmount: 12,
        allocations: [
          { contributor: 'Person A', amount: 4 },
          { contributor: 'Person B', amount: 3 },
          { contributor: 'Person C', amount: 3 },
          { contributor: 'Person D', amount: 2 },
        ],
      },
      stats: { total: 12, entryCount: 1, allocationCount: 4 },
    });
    expect(
      await env.DB.prepare(
        'SELECT total, event_count, entry_count FROM challenge_state WHERE id = 1',
      ).first(),
    ).toEqual({ total: 12, event_count: 4, entry_count: 1 });
    expect(
      await env.DB.prepare(
        'SELECT display_name, net_total FROM contributor_totals ORDER BY display_name',
      ).all(),
    ).toMatchObject({
      results: [
        { display_name: 'Person A', net_total: 4 },
        { display_name: 'Person B', net_total: 3 },
        { display_name: 'Person C', net_total: 3 },
        { display_name: 'Person D', net_total: 2 },
      ],
    });
    expect(
      await env.DB.prepare('SELECT net_total, event_count, entry_count FROM daily_totals').first(),
    ).toEqual({ net_total: 12, event_count: 4, entry_count: 1 });
  });

  it.each([
    [
      'sum below total',
      groupBody({
        allocations: [
          { contributor: 'A', amount: 5 },
          { contributor: 'B', amount: 6 },
        ],
      }),
    ],
    [
      'sum above total',
      groupBody({
        allocations: [
          { contributor: 'A', amount: 7 },
          { contributor: 'B', amount: 6 },
        ],
      }),
    ],
    [
      'positive total with negative child',
      groupBody({
        allocations: [
          { contributor: 'A', amount: 14 },
          { contributor: 'B', amount: -2 },
        ],
      }),
    ],
    [
      'negative total with positive child',
      groupBody({
        totalAmount: -6,
        allocations: [
          { contributor: 'A', amount: -8 },
          { contributor: 'B', amount: 2 },
        ],
        note: 'Invalid correction',
      }),
    ],
    [
      'missing participant name',
      groupBody({
        allocations: [
          { contributor: 'A', amount: 6 },
          { contributor: '   ', amount: 6 },
        ],
      }),
    ],
    [
      'duplicate normalized participant',
      groupBody({
        allocations: [
          { contributor: 'Arhaan', amount: 6 },
          { contributor: '  arhaan  ', amount: 6 },
        ],
      }),
    ],
    [
      'correction without reason',
      groupBody({
        totalAmount: -6,
        allocations: [
          { contributor: 'A', amount: -3 },
          { contributor: 'B', amount: -3 },
        ],
        note: '',
      }),
    ],
    [
      'too many participants',
      groupBody({
        totalAmount: 26,
        allocations: Array.from({ length: 26 }, (_, index) => ({
          contributor: `Person ${index}`,
          amount: 1,
        })),
      }),
    ],
  ])('rejects %s', async (_label, body) => {
    expect((await entry(await token(), body)).status).toBe(400);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM beer_entries').first()).toEqual({
      count: 0,
    });
  });

  it('records a group correction and prevents the overall total becoming negative', async () => {
    const editorToken = await token();
    expect((await entry(editorToken, groupBody())).status).toBe(201);
    const correction = await entry(
      editorToken,
      groupBody({
        totalAmount: -6,
        allocations: [
          { contributor: 'Person A', amount: -2 },
          { contributor: 'Person B', amount: -2 },
          { contributor: 'Person C', amount: -1 },
          { contributor: 'Person D', amount: -1 },
        ],
        note: 'Correcting the group total',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    expect(correction.status).toBe(201);
    expect(await correction.json()).toMatchObject({
      entry: { totalAmount: -6, isCorrection: true },
      stats: { total: 6, entryCount: 2, allocationCount: 8 },
    });
    const belowZero = await entry(
      editorToken,
      groupBody({
        totalAmount: -7,
        allocations: [
          { contributor: 'Person A', amount: -4 },
          { contributor: 'Person B', amount: -3 },
        ],
        note: 'Would make total negative',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    expect(belowZero.status).toBe(409);
    expect(
      await env.DB.prepare(
        'SELECT total, event_count, entry_count FROM challenge_state WHERE id = 1',
      ).first(),
    ).toEqual({ total: 6, event_count: 8, entry_count: 2 });
  });

  it('returns an exact retry once and rejects conflicting reuse of its key', async () => {
    const editorToken = await token();
    const idempotencyKey = crypto.randomUUID();
    const body = groupBody({ idempotencyKey });
    expect((await entry(editorToken, body)).status).toBe(201);
    const retry = await entry(editorToken, body);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ idempotent: true, stats: { total: 12 } });
    const conflict = await entry(
      editorToken,
      groupBody({ idempotencyKey, note: 'Different data' }),
    );
    expect(conflict.status).toBe(409);
    expect(
      await env.DB.prepare(
        'SELECT total, event_count, entry_count FROM challenge_state WHERE id = 1',
      ).first(),
    ).toEqual({ total: 12, event_count: 4, entry_count: 1 });
  });

  it('handles concurrent duplicate requests without double counting', async () => {
    const editorToken = await token();
    const body = groupBody({ idempotencyKey: crypto.randomUUID() });
    const responses = await Promise.all([
      entry(editorToken, body, '192.0.2.40'),
      entry(editorToken, body, '192.0.2.40'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(
      await env.DB.prepare(
        'SELECT total, event_count, entry_count FROM challenge_state WHERE id = 1',
      ).first(),
    ).toEqual({ total: 12, event_count: 4, entry_count: 1 });
  });

  it('rolls back the parent and every aggregate when one child insert fails', async () => {
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_allocation
       BEFORE INSERT ON beer_events
       WHEN NEW.contributor_key = 'rollback'
       BEGIN
         SELECT RAISE(ABORT, 'forced test failure');
       END;`,
    ).run();
    try {
      const response = await entry(
        await token(),
        groupBody({
          totalAmount: 4,
          allocations: [
            { contributor: 'Safe', amount: 2 },
            { contributor: 'Rollback', amount: 2 },
          ],
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      expect(response.status).toBe(500);
      expect(await env.DB.prepare('SELECT count(*) AS count FROM beer_entries').first()).toEqual({
        count: 0,
      });
      expect(await env.DB.prepare('SELECT count(*) AS count FROM beer_events').first()).toEqual({
        count: 0,
      });
      expect(
        await env.DB.prepare(
          'SELECT total, event_count, entry_count FROM challenge_state WHERE id = 1',
        ).first(),
      ).toEqual({ total: 0, event_count: 0, entry_count: 0 });
    } finally {
      await env.DB.prepare('DROP TRIGGER test_fail_allocation').run();
    }
  });

  it('returns grouped recent entries in order without exposing internal fields', async () => {
    await entry(await token(), groupBody());
    const response = await call('/api/summary', { headers: { Origin: origin } });
    const text = await response.text();
    expect(text).not.toMatch(
      /session_fingerprint|idempotency_key|contributor_key|allocation_index/iu,
    );
    const summary = JSON.parse(text) as {
      stats: { eventCount: number; entryCount: number; allocationCount: number };
      recentEntries: Array<{
        totalAmount: number;
        isGroup: boolean;
        allocations: Array<{ contributor: string; amount: number }>;
      }>;
    };
    expect(summary.stats).toEqual(
      expect.objectContaining({ eventCount: 1, entryCount: 1, allocationCount: 4 }),
    );
    expect(summary.recentEntries[0]).toMatchObject({
      totalAmount: 12,
      isGroup: true,
      allocations: [
        { contributor: 'Person A', amount: 4 },
        { contributor: 'Person B', amount: 3 },
        { contributor: 'Person C', amount: 3 },
        { contributor: 'Person D', amount: 2 },
      ],
    });
  });

  it('completes the isolated +3, +12, retry, and -12 verification sequence', async () => {
    const editorToken = await token();
    const singleKey = crypto.randomUUID();
    expect(
      (
        await call('/api/events', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${editorToken}`,
            'Content-Type': 'application/json',
            Origin: origin,
            'CF-Connecting-IP': '192.0.2.50',
          },
          body: JSON.stringify({
            amount: 3,
            contributor: 'Single Person',
            note: 'Local sequence',
            idempotencyKey: singleKey,
          }),
        })
      ).status,
    ).toBe(201);
    const groupKey = crypto.randomUUID();
    const positive = groupBody({ idempotencyKey: groupKey });
    expect((await entry(editorToken, positive)).status).toBe(201);
    expect((await entry(editorToken, positive)).status).toBe(200);
    expect(
      await env.DB.prepare(
        'SELECT total, event_count, entry_count FROM challenge_state WHERE id = 1',
      ).first(),
    ).toEqual({ total: 15, event_count: 5, entry_count: 2 });

    const correction = groupBody({
      totalAmount: -12,
      allocations: [
        { contributor: 'Person A', amount: -4 },
        { contributor: 'Person B', amount: -3 },
        { contributor: 'Person C', amount: -3 },
        { contributor: 'Person D', amount: -2 },
      ],
      note: 'Reverse local group verification',
      idempotencyKey: crypto.randomUUID(),
    });
    expect((await entry(editorToken, correction)).status).toBe(201);
    expect(
      await env.DB.prepare(
        'SELECT total, event_count, entry_count FROM challenge_state WHERE id = 1',
      ).first(),
    ).toEqual({ total: 3, event_count: 9, entry_count: 3 });
    expect(
      await env.DB.prepare(
        `SELECT display_name, net_total
         FROM contributor_totals ORDER BY display_name`,
      ).all(),
    ).toMatchObject({
      results: [
        { display_name: 'Person A', net_total: 0 },
        { display_name: 'Person B', net_total: 0 },
        { display_name: 'Person C', net_total: 0 },
        { display_name: 'Person D', net_total: 0 },
        { display_name: 'Single Person', net_total: 3 },
      ],
    });
  });
});
