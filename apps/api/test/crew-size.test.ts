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
      'CF-Connecting-IP': '192.0.2.40',
    },
    body: JSON.stringify({ code: 'test-crew-code' }),
  });
  return (await response.json<{ token: string }>()).token;
}

async function recordEvent(
  editorToken: string,
  contributor: string | undefined,
  amount = 1,
): Promise<void> {
  const response = await call('/api/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${editorToken}`,
      'Content-Type': 'application/json',
      Origin: origin,
      'CF-Connecting-IP': '192.0.2.41',
    },
    body: JSON.stringify({
      amount,
      contributor,
      note: amount < 0 ? 'Crew size correction' : '',
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  expect(response.status).toBe(201);
}

async function recordGroup(
  editorToken: string,
  allocations: { contributor: string; amount: number }[],
): Promise<void> {
  const totalAmount = allocations.reduce((total, allocation) => total + allocation.amount, 0);
  const response = await call('/api/entries', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${editorToken}`,
      'Content-Type': 'application/json',
      Origin: origin,
      'CF-Connecting-IP': '192.0.2.42',
    },
    body: JSON.stringify({
      totalAmount,
      allocations,
      note: totalAmount < 0 ? 'Crew size group correction' : 'Crew size group entry',
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  expect(response.status).toBe(201);
}

async function summaryResponse(): Promise<Response> {
  return call('/api/summary', { headers: { Origin: origin } });
}

async function crewSize(): Promise<number> {
  const body = await (await summaryResponse()).json<{ stats: { crewSize: number } }>();
  return body.stats.crewSize;
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

describe('Crew Size summary statistic', () => {
  it('starts at numeric zero and does not expose internal contributor fields', async () => {
    const response = await summaryResponse();
    const text = await response.text();
    const body = JSON.parse(text) as { stats: { crewSize: unknown } };

    expect(body.stats.crewSize).toBe(0);
    expect(typeof body.stats.crewSize).toBe('number');
    expect(text).not.toMatch(/contributor_key|crew_size/iu);
  });

  it('counts one named positive contributor', async () => {
    await recordEvent(await token(), 'Arhaan');
    expect(await crewSize()).toBe(1);
  });

  it('counts repeated positive allocations for one contributor once', async () => {
    const editorToken = await token();
    await recordEvent(editorToken, 'Arhaan');
    await recordEvent(editorToken, 'Arhaan');
    expect(await crewSize()).toBe(1);
  });

  it('deduplicates whitespace, case, and NFKC-normalized name variants', async () => {
    const editorToken = await token();
    await recordEvent(editorToken, 'Arhaan');
    await recordEvent(editorToken, '  arhaan  ');
    await recordEvent(editorToken, 'ＡＲＨＡＡＮ');
    expect(await crewSize()).toBe(1);
  });

  it('counts two distinct named contributors', async () => {
    const editorToken = await token();
    await recordEvent(editorToken, 'Arhaan');
    await recordEvent(editorToken, 'Sam');
    expect(await crewSize()).toBe(2);
  });

  it('counts every named recipient in a four-person split', async () => {
    await recordGroup(await token(), [
      { contributor: 'Arhaan', amount: 4 },
      { contributor: 'Sam', amount: 3 },
      { contributor: 'Alex', amount: 3 },
      { contributor: 'Rohan', amount: 2 },
    ]);
    expect(await crewSize()).toBe(4);
  });

  it('deduplicates a contributor shared by single and group entries', async () => {
    const editorToken = await token();
    await recordEvent(editorToken, 'Arhaan');
    await recordGroup(editorToken, [
      { contributor: 'Arhaan', amount: 1 },
      { contributor: 'Sam', amount: 1 },
      { contributor: 'Alex', amount: 1 },
      { contributor: 'Rohan', amount: 1 },
    ]);
    expect(await crewSize()).toBe(4);
  });

  it('does not decrement after a contributor is fully corrected', async () => {
    const editorToken = await token();
    await recordEvent(editorToken, 'Arhaan', 3);
    await recordEvent(editorToken, 'Arhaan', -3);
    expect(await crewSize()).toBe(1);
  });

  it('ignores a correction-only contributor until their first positive allocation', async () => {
    const editorToken = await token();
    await recordEvent(editorToken, undefined, 2);
    await recordEvent(editorToken, 'Sam', -1);
    expect(await crewSize()).toBe(0);

    await recordEvent(editorToken, 'Sam', 1);
    expect(await crewSize()).toBe(1);
  });

  it('excludes missing and normalized Anonymous contributors', async () => {
    const editorToken = await token();
    await recordEvent(editorToken, undefined);
    await recordEvent(editorToken, '  anonymous  ');
    expect(await crewSize()).toBe(0);
  });

  it('excludes Anonymous while retaining named contributors', async () => {
    const editorToken = await token();
    await recordEvent(editorToken, 'Arhaan');
    await recordEvent(editorToken, 'Anonymous');
    expect(await crewSize()).toBe(1);
  });

  it('returns a non-null number after mixed single, split, and correction activity', async () => {
    const editorToken = await token();
    await recordEvent(editorToken, 'Arhaan');
    await recordGroup(editorToken, [
      { contributor: 'Sam', amount: 2 },
      { contributor: 'Alex', amount: 1 },
    ]);
    await recordEvent(editorToken, 'Correction Only', -1);

    const response = await summaryResponse();
    const body = await response.json<{ stats: { crewSize: unknown } }>();
    expect(body.stats.crewSize).toBe(3);
    expect(typeof body.stats.crewSize).toBe('number');
  });
});
