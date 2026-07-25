import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const apiBaseUrl = process.env.API_BASE_URL?.replace(/\/$/u, '');
const origin = process.env.ORIGIN;
let crewCode = process.env.BEER_ADMIN_PIN;

if (!crewCode) {
  const localVariables = await readFile('apps/api/.dev.vars', 'utf8').catch(() => '');
  const codeLine = localVariables
    .split(/\r?\n/u)
    .find((line) => line.startsWith('BEER_ADMIN_PIN='));
  crewCode = codeLine?.slice('BEER_ADMIN_PIN='.length);
}

if (!apiBaseUrl || !origin || !crewCode) {
  throw new Error('Set API_BASE_URL, ORIGIN, and BEER_ADMIN_PIN before running the smoke test.');
}

async function json(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${body?.error ?? 'unknown error'}`);
  }
  return { response, body };
}

const headers = { Origin: origin, 'Content-Type': 'application/json' };
const health = await json('/health', { headers: { Origin: origin } });
if (health.body?.ok !== true) throw new Error('Health response was not healthy.');

const before = await json('/api/summary', { headers: { Origin: origin } });
const initialTotal = before.body?.stats?.total;
if (!Number.isInteger(initialTotal)) throw new Error('Summary did not contain an integer total.');

const login = await json('/api/login', {
  method: 'POST',
  headers,
  body: JSON.stringify({ code: crewCode }),
});
const token = login.body?.token;
if (typeof token !== 'string') throw new Error('Login did not return an editor token.');

const authorizationHeaders = { ...headers, Authorization: `Bearer ${token}` };
const positiveKey = randomUUID();
const positivePayload = {
  amount: 1,
  contributor: 'Production Smoke Test',
  note: 'Temporary deployment verification',
  idempotencyKey: positiveKey,
};
const positive = await json('/api/events', {
  method: 'POST',
  headers: authorizationHeaders,
  body: JSON.stringify(positivePayload),
});
if (positive.body?.total !== initialTotal + 1)
  throw new Error('Positive smoke event did not increment exactly once.');

const duplicate = await json('/api/events', {
  method: 'POST',
  headers: authorizationHeaders,
  body: JSON.stringify(positivePayload),
});
if (duplicate.body?.total !== initialTotal + 1 || duplicate.body?.idempotent !== true) {
  throw new Error('Duplicate idempotency check failed.');
}

const correction = await json('/api/events', {
  method: 'POST',
  headers: authorizationHeaders,
  body: JSON.stringify({
    amount: -1,
    contributor: 'Production Smoke Test',
    note: 'Reversing temporary deployment verification',
    idempotencyKey: randomUUID(),
  }),
});
if (correction.body?.total !== initialTotal)
  throw new Error('Correction did not restore the original total.');

const after = await json('/api/summary', { headers: { Origin: origin } });
if (after.body?.stats?.total !== initialTotal)
  throw new Error('Final summary total did not return to its starting value.');

console.log(
  `Smoke test passed: health, summary, login, +1, duplicate retry, -1, and net-zero verification.`,
);
