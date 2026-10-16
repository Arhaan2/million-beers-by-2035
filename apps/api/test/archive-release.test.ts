import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src';
import { createBeerEntry } from '../src/database';
import { parseEntryBody } from '../src/schemas';
import type { PublicEntry } from '../src/types';

async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
  ip = '192.0.2.1',
) {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com${path}`, {
      method,
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': ip,
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

async function login() {
  const response = await call('/api/login', 'POST', { code: 'test-crew-code' });
  expect(response.status).toBe(200);
  return (await response.json<{ token: string }>()).token;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    totalAmount: 3,
    allocations: [{ contributor: 'Synthetic person', amount: 3 }],
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

async function save(overrides: Record<string, unknown> = {}, at = '2026-02-15T12:00:00Z') {
  return createBeerEntry(env, parseEntryBody(input(overrides)), 'synthetic-test', Date.parse(at));
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
});

describe('bounded writes across reauthentication', () => {
  it('retains each session budget and a larger shared-network budget after valid re-logins', async () => {
    const accepted = input();
    for (let friend = 0; friend < 10; friend += 1) {
      const token = await login();
      for (let update = 0; update < Number(env.MUTATION_RATE_LIMIT_MAX); update += 1)
        expect(
          (
            await call(
              '/api/entries',
              'POST',
              friend === 0 && update === 0 ? accepted : input(),
              token,
            )
          ).status,
        ).toBe(201);
      if (friend === 0)
        expect((await call('/api/entries', 'POST', input(), token)).status).toBe(429);
    }
    const newSession = await login();
    expect((await call('/api/entries', 'POST', input(), newSession)).status).toBe(429);
    expect((await call('/api/entries', 'POST', accepted, newSession)).status).toBe(200);
    expect(
      (await call('/api/members', 'POST', { displayName: 'Shared network member' }, newSession))
        .status,
    ).toBe(429);
    expect((await call('/api/entries', 'POST', input(), newSession, '192.0.2.2')).status).toBe(201);
    const rows = await env.DB.prepare('SELECT key_hash FROM rate_limits').all();
    expect(JSON.stringify(rows.results)).not.toContain('192.0.2.1');
    await env.DB.prepare(
      "UPDATE rate_limits SET window_started_at=0 WHERE scope='mutation_network'",
    ).run();
    expect((await call('/api/entries', 'POST', input(), newSession)).status).toBe(201);
  });

  it('resolves exact accepted entry and legacy-event retries even after throttling', async () => {
    const token = await login();
    const entry = input();
    const event = {
      amount: 1,
      contributor: 'Synthetic legacy',
      idempotencyKey: crypto.randomUUID(),
    };
    expect((await call('/api/entries', 'POST', entry, token)).status).toBe(201);
    expect((await call('/api/events', 'POST', event, token)).status).toBe(201);
    for (let update = 2; update < Number(env.MUTATION_RATE_LIMIT_MAX); update += 1)
      expect((await call('/api/entries', 'POST', input(), token)).status).toBe(201);
    expect((await call('/api/entries', 'POST', input(), token)).status).toBe(429);
    expect((await call('/api/entries', 'POST', entry, token)).status).toBe(200);
    expect((await call('/api/events', 'POST', event, token)).status).toBe(200);
    expect(
      (await call('/api/entries', 'POST', { ...entry, note: 'Different request' }, token)).status,
    ).toBe(409);
    expect(await env.DB.prepare('SELECT total,entry_count FROM challenge_state').first()).toEqual({
      total: 88,
      entry_count: 30,
    });
  });
});

describe('consistent filtered public archives', () => {
  it('uses the complete matching dataset for recap totals and highlights, independent of page cursor', async () => {
    const matching = await save({
      memory: { venue: 'Park', city: 'Los Angeles', brewery: 'Local', title: 'Picnic' },
    });
    await save({
      totalAmount: -1,
      allocations: [
        {
          contributor: 'Synthetic person',
          amount: -1,
          sourceAllocationId: matching.entry.allocations[0]!.id,
        },
      ],
      note: 'Synthetic correction',
      correctionOfEntryId: matching.entry.id,
      memory: { venue: 'Park', city: 'Los Angeles', brewery: 'Local', title: 'Picnic correction' },
    });
    await save({ memory: { venue: 'Other', city: 'Los Angeles', brewery: 'Other' } });
    await save({ memory: { venue: 'Park', city: 'San Francisco', brewery: 'Local' } });
    await save({ memory: { venue: 'Park', city: 'Los Angeles', visibility: 'private' } });
    await save(
      { memory: { venue: 'Park', city: 'Los Angeles', brewery: 'Local' } },
      '2026-03-15T12:00:00Z',
    );
    const query = 'period=2026-02&venue=Park&city=Los%20Angeles&brewery=Local&q=Picnic&limit=1';
    const first = await (
      await call(`/api/recaps?${query}`)
    ).json<{ entries: PublicEntry[]; nextCursor: string }>();
    expect(first).toMatchObject({
      netTotal: 2,
      entryCount: 2,
      participantCount: 1,
      publicPlaceCount: 1,
      cityCount: 1,
      breweryCount: 1,
      availableMonths: ['2026-02'],
      dateBasis: 'recorded',
    });
    expect(first.entries).toHaveLength(1);
    const next = await (
      await call(`/api/recaps?${query}&cursor=${encodeURIComponent(first.nextCursor)}`)
    ).json<{ entries: PublicEntry[] }>();
    expect(next).toMatchObject({
      netTotal: 2,
      entryCount: 2,
      participantCount: 1,
      nextCursor: null,
    });
    expect(next.entries[0]?.id).not.toBe(first.entries[0]?.id);
  });

  it('rejects mixed-revision archive pages after a new entry, metadata edit, or privacy change', async () => {
    const saved = await save({ memory: { title: 'Original memory', city: 'Public city' } });
    await save();
    const first = await (
      await call('/api/entries?limit=1')
    ).json<{ revision: number; nextCursor: string }>();
    expect(first.revision).toBeTypeOf('number');
    expect(
      (
        await call(
          `/api/entries?limit=1&revision=${first.revision}&cursor=${encodeURIComponent(first.nextCursor)}`,
        )
      ).status,
    ).toBe(200);
    await save();
    expect((await call(`/api/entries?revision=${first.revision}`)).status).toBe(409);
    let current = await (await call('/api/entries')).json<{ revision: number }>();
    await env.DB.prepare(
      "UPDATE entry_metadata SET title='Changed memory',version=version+1 WHERE entry_id=?",
    )
      .bind(saved.entry.id)
      .run();
    expect((await call(`/api/entries?revision=${current.revision}`)).status).toBe(409);
    current = await (await call('/api/entries')).json<{ revision: number }>();
    await env.DB.prepare('UPDATE crew_members SET public_display=0 WHERE id=?')
      .bind(saved.entry.allocations[0]!.memberId)
      .run();
    const rejected = await call(`/api/entries?revision=${current.revision}`);
    expect(rejected.status).toBe(409);
    expect(await rejected.text()).not.toMatch(/Changed memory|Public city|Synthetic person/);
    expect(await (await call('/api/entries?city=Public')).json()).toMatchObject({ entries: [] });
    expect((await call('/api/entries?revision=NaN')).status).toBe(400);
  });

  it('uses LA recording boundaries and exposes only actual matching months', async () => {
    await save({}, '2024-03-01T07:59:59Z');
    await save({}, '2024-03-01T08:00:00Z');
    const leap = await (await call('/api/recaps?period=2024-02')).json();
    expect(leap).toMatchObject({
      entryCount: 1,
      netTotal: 3,
      availableMonths: ['2024-03', '2024-02'],
    });
    expect(await (await call('/api/recaps?period=2024')).json()).toMatchObject({
      entryCount: 2,
      netTotal: 6,
    });
    for (const period of ['0000', '2026-13', '10000', '2026-02-30'])
      expect((await call(`/api/recaps?period=${period}`)).status).toBe(400);
    expect((await call('/api/recaps?period=9999')).status).toBe(200);
  });

  it('exports tied-timestamp records across bounded pages with consistent signed amounts and privacy', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 57; index += 1) {
      const result = await save({
        allocations: [{ contributor: `Synthetic ${index}`, amount: 3 }],
        memory: { title: `Unicode café ${index} 🍻`, city: 'Portland' },
      });
      ids.push(result.entry.id);
    }
    const correction = await save({
      totalAmount: -1,
      allocations: [{ contributor: 'Synthetic 0', amount: -1 }],
      note: 'Legacy adjustment',
      memory: { city: 'Portland' },
    });
    ids.push(correction.entry.id);
    await save({ memory: { title: 'Private title', city: 'Portland', visibility: 'private' } });
    const exported: PublicEntry[] = [];
    let revision: number | undefined;
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ city: 'Portland', limit: '7' });
      if (revision !== undefined) query.set('revision', String(revision));
      if (cursor) query.set('cursor', cursor);
      const response = await call(`/api/entries?${query.toString()}`);
      expect(response.status).toBe(200);
      const page = await response.json<{
        revision: number;
        entries: PublicEntry[];
        nextCursor: string | null;
      }>();
      revision ??= page.revision;
      expect(page.revision).toBe(revision);
      exported.push(...page.entries);
      cursor = page.nextCursor;
    } while (cursor);
    expect(exported.map((entry) => entry.id).sort()).toEqual(ids.sort());
    expect(new Set(exported.map((entry) => entry.id)).size).toBe(58);
    expect(exported.reduce((sum, entry) => sum + entry.totalAmount, 0)).toBe(170);
    expect(JSON.stringify(exported)).not.toMatch(
      /Private title|session_fingerprint|idempotency_key|payload_json|projection_audit/,
    );
    expect((await call(`/api/entries?revision=${revision}&limit=1`)).status).toBe(200);
    expect(
      await (await call('/api/recaps?period=2026-02&city=Portland&limit=1')).json(),
    ).toMatchObject({ netTotal: 170, entryCount: 58, participantCount: 57, cityCount: 1 });
  });
});
