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

async function login(code = 'test-crew-code', ip = '192.0.2.10'): Promise<Response> {
  return call('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ code }),
  });
}

async function token(): Promise<string> {
  const response = await login();
  const body = await response.json<{ token: string }>();
  return body.token;
}

async function event(
  editorToken: string,
  body: Record<string, unknown>,
  ip = '192.0.2.20',
): Promise<Response> {
  return call('/api/events', {
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

describe('public API and CORS', () => {
  it('returns health and an initial summary without internal fields', async () => {
    expect(await (await call('/health')).json()).toEqual({
      ok: true,
      service: 'million-beers-api',
    });
    const response = await call('/api/summary', { headers: { Origin: origin } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    const text = await response.text();
    expect(text).not.toMatch(/session_fingerprint|idempotency_key|key_hash/iu);
    expect(JSON.parse(text)).toMatchObject({ stats: { total: 0, eventCount: 0 } });
  });

  it('allows preflight from configured origins and rejects others', async () => {
    const allowed = await call('/api/events', { method: 'OPTIONS', headers: { Origin: origin } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    const rejected = await call('/api/events', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('login security', () => {
  it('rejects an invalid crew code with a generic message', async () => {
    const response = await login('wrong-code');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'Invalid crew code.' });
  });

  it('rate limits repeated login failures by hashed IP', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login('wrong-code', '198.51.100.7')).status).toBe(401);
    }
    expect((await login('wrong-code', '198.51.100.7')).status).toBe(429);
    const row = await env.DB.prepare('SELECT key_hash FROM rate_limits WHERE scope = ?')
      .bind('login')
      .first<{ key_hash: string }>();
    expect(row?.key_hash).not.toContain('198.51.100.7');
  });
});

describe('event ledger', () => {
  it('requires authorization and validates amount and correction reason', async () => {
    const missing = await event('', { amount: 1, idempotencyKey: crypto.randomUUID() });
    expect(missing.status).toBe(401);
    const editorToken = await token();
    expect(
      (await event(editorToken, { amount: 0, idempotencyKey: crypto.randomUUID() })).status,
    ).toBe(400);
    expect(
      (await event(editorToken, { amount: -1, note: 'no', idempotencyKey: crypto.randomUUID() }))
        .status,
    ).toBe(400);
  });

  it('records positive events and corrections atomically', async () => {
    const editorToken = await token();
    const positive = await event(editorToken, {
      amount: 4,
      contributor: '  Test   Crew  ',
      note: 'First entry',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(positive.status).toBe(201);
    expect(await positive.json()).toMatchObject({
      total: 4,
      idempotent: false,
      event: { contributor: 'Test Crew' },
    });

    const correction = await event(editorToken, {
      amount: -2,
      contributor: 'Test Crew',
      note: 'Duplicate correction',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(correction.status).toBe(201);
    expect(await correction.json()).toMatchObject({ total: 2 });

    const state = await env.DB.prepare(
      'SELECT total, event_count, entry_count FROM challenge_state WHERE id = 1',
    ).first();
    const contributor = await env.DB.prepare(
      'SELECT net_total, event_count FROM contributor_totals',
    ).first();
    const daily = await env.DB.prepare('SELECT net_total, event_count FROM daily_totals').first();
    expect(state).toEqual({ total: 2, event_count: 2, entry_count: 2 });
    expect(contributor).toEqual({ net_total: 2, event_count: 2 });
    expect(daily).toEqual({ net_total: 2, event_count: 2 });
  });

  it('does not double count a duplicate idempotency key', async () => {
    const editorToken = await token();
    const idempotencyKey = crypto.randomUUID();
    const body = { amount: 3, contributor: 'Retry', note: '', idempotencyKey };
    expect((await event(editorToken, body)).status).toBe(201);
    const duplicate = await event(editorToken, body);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ total: 3, idempotent: true });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM beer_events').first()).toEqual({
      count: 1,
    });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM beer_entries').first()).toEqual({
      count: 1,
    });
  });

  it('prevents a correction from taking the total below zero', async () => {
    const response = await event(await token(), {
      amount: -1,
      contributor: 'Correction',
      note: 'Nothing to reverse',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(409);
    expect(
      await env.DB.prepare('SELECT total, event_count, entry_count FROM challenge_state').first(),
    ).toEqual({ total: 0, event_count: 0, entry_count: 0 });
  });

  it('rejects mutation requests from an unapproved browser origin', async () => {
    const editorToken = await token();
    const response = await call('/api/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${editorToken}`,
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ amount: 1, idempotencyKey: crypto.randomUUID() }),
    });
    expect(response.status).toBe(403);
  });
});
