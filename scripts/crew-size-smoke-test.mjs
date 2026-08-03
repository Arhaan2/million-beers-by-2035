import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const apiBaseUrl = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:8787');
if (!['127.0.0.1', 'localhost'].includes(apiBaseUrl.hostname)) {
  throw new Error('Crew Size smoke test is local-only and refuses a remote API URL.');
}

const origin = process.env.ORIGIN ?? 'http://localhost:5173';
let crewCode = process.env.BEER_ADMIN_PIN;

if (!crewCode) {
  const localVariables = await readFile('apps/api/.dev.vars', 'utf8').catch(() => '');
  const codeLine = localVariables
    .split(/\r?\n/u)
    .find((line) => line.startsWith('BEER_ADMIN_PIN='));
  crewCode = codeLine?.slice('BEER_ADMIN_PIN='.length);
}

if (!crewCode) throw new Error('Set BEER_ADMIN_PIN or configure apps/api/.dev.vars.');

async function json(path, init = {}) {
  const response = await fetch(new URL(path, apiBaseUrl), init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${body?.error ?? 'unknown error'}`);
  }
  return body;
}

const headers = { Origin: origin, 'Content-Type': 'application/json' };
const login = await json('/api/login', {
  method: 'POST',
  headers,
  body: JSON.stringify({ code: crewCode }),
});
if (typeof login?.token !== 'string') throw new Error('Login did not return an editor token.');
const authorized = { ...headers, Authorization: `Bearer ${login.token}` };
const before = await json('/api/summary', { headers: { Origin: origin } });
const initialCrewSize = before?.stats?.crewSize;
const initialTotal = before?.stats?.total;
if (!Number.isInteger(initialCrewSize) || !Number.isInteger(initialTotal)) {
  throw new Error('Summary did not contain integer total and Crew Size values.');
}

const suffix = randomUUID().slice(0, 8);
const personA = `Crew A ${suffix}`;
const people = [personA, `Crew B ${suffix}`, `Crew C ${suffix}`, `Crew D ${suffix}`];

async function event(contributor, amount, note = '') {
  await json('/api/events', {
    method: 'POST',
    headers: authorized,
    body: JSON.stringify({ amount, contributor, note, idempotencyKey: randomUUID() }),
  });
}

async function assertCrewSize(expected, checkpoint) {
  const summary = await json('/api/summary', { headers: { Origin: origin } });
  if (summary?.stats?.crewSize !== expected) {
    throw new Error(
      `${checkpoint}: expected Crew Size ${expected}, got ${summary?.stats?.crewSize}.`,
    );
  }
}

await event(personA, 1);
await assertCrewSize(initialCrewSize + 1, 'first named positive allocation');
await event(`  ${personA.toLocaleLowerCase('en-US')}  `, 1);
await assertCrewSize(initialCrewSize + 1, 'normalized repeat allocation');

await json('/api/entries', {
  method: 'POST',
  headers: authorized,
  body: JSON.stringify({
    totalAmount: 4,
    allocations: people.map((contributor) => ({ contributor, amount: 1 })),
    note: 'Crew Size local group verification',
    idempotencyKey: randomUUID(),
  }),
});
await assertCrewSize(initialCrewSize + 4, 'four-person split');

await event(personA, -1, 'Crew Size local correction');
await assertCrewSize(initialCrewSize + 4, 'correction');
await event('Anonymous', 1);
await assertCrewSize(initialCrewSize + 4, 'Anonymous allocation');
await event('Anonymous', -6, 'Restore local smoke total');

const after = await json('/api/summary', { headers: { Origin: origin } });
if (after?.stats?.total !== initialTotal) {
  throw new Error('Crew Size smoke test did not restore the local beer total.');
}

console.log(
  'Crew Size smoke test passed: repeat normalization, four-person split, correction persistence, Anonymous exclusion, and net-zero total restoration.',
);
