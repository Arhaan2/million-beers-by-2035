import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const apiBaseUrl = (process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/u, '');
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

async function request(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function json(path, init = {}) {
  const result = await request(path, init);
  if (!result.response.ok) {
    throw new Error(
      `${path} returned ${result.response.status}: ${result.body?.error ?? 'unknown error'}`,
    );
  }
  return result.body;
}

const headers = { Origin: origin, 'Content-Type': 'application/json' };
const before = await json('/api/summary', { headers: { Origin: origin } });
const initialTotal = before?.stats?.total;
const initialEntries = before?.stats?.entryCount;
const initialAllocations = before?.stats?.allocationCount;
if (![initialTotal, initialEntries, initialAllocations].every(Number.isInteger)) {
  throw new Error('Summary did not contain integer group-entry counters.');
}

const login = await json('/api/login', {
  method: 'POST',
  headers,
  body: JSON.stringify({ code: crewCode }),
});
if (typeof login?.token !== 'string') throw new Error('Login did not return an editor token.');
const authorized = { ...headers, Authorization: `Bearer ${login.token}` };

await json('/api/events', {
  method: 'POST',
  headers: authorized,
  body: JSON.stringify({
    amount: 3,
    contributor: 'Local Verify Single',
    note: 'Local group feature sequence',
    idempotencyKey: randomUUID(),
  }),
});

const groupKey = randomUUID();
const groupPayload = {
  totalAmount: 12,
  allocations: [
    { contributor: 'Local Verify A', amount: 4 },
    { contributor: 'Local Verify B', amount: 3 },
    { contributor: 'Local Verify C', amount: 3 },
    { contributor: 'Local Verify D', amount: 2 },
  ],
  note: 'Local group feature verification',
  idempotencyKey: groupKey,
};
const positive = await json('/api/entries', {
  method: 'POST',
  headers: authorized,
  body: JSON.stringify(groupPayload),
});
if (positive?.stats?.total !== initialTotal + 15) {
  throw new Error('Single and group entries did not increase the total by exactly 15.');
}
const retry = await json('/api/entries', {
  method: 'POST',
  headers: authorized,
  body: JSON.stringify(groupPayload),
});
if (retry?.idempotent !== true || retry?.stats?.total !== initialTotal + 15) {
  throw new Error('Group idempotency retry changed the aggregate.');
}

await json('/api/entries', {
  method: 'POST',
  headers: authorized,
  body: JSON.stringify({
    totalAmount: -12,
    allocations: [
      { contributor: 'Local Verify A', amount: -4 },
      { contributor: 'Local Verify B', amount: -3 },
      { contributor: 'Local Verify C', amount: -3 },
      { contributor: 'Local Verify D', amount: -2 },
    ],
    note: 'Reverse local group feature verification',
    idempotencyKey: randomUUID(),
  }),
});

for (const invalid of [
  {
    totalAmount: 5,
    allocations: [
      { contributor: 'Mismatch A', amount: 2 },
      { contributor: 'Mismatch B', amount: 2 },
    ],
    note: '',
    idempotencyKey: randomUUID(),
  },
  {
    totalAmount: 4,
    allocations: [
      { contributor: 'Duplicate', amount: 2 },
      { contributor: ' duplicate ', amount: 2 },
    ],
    note: '',
    idempotencyKey: randomUUID(),
  },
]) {
  const rejected = await request('/api/entries', {
    method: 'POST',
    headers: authorized,
    body: JSON.stringify(invalid),
  });
  if (rejected.response.status !== 400) {
    throw new Error('Invalid group payload was not rejected.');
  }
}

const after = await json('/api/summary', { headers: { Origin: origin } });
if (
  after?.stats?.total !== initialTotal + 3 ||
  after?.stats?.entryCount !== initialEntries + 3 ||
  after?.stats?.allocationCount !== initialAllocations + 9
) {
  throw new Error('Final totals, entry count, or allocation count did not match the sequence.');
}
if (!Array.isArray(after?.recentEntries) || after.recentEntries.length < 3) {
  throw new Error('Grouped activity was not returned by the summary API.');
}

console.log(
  'Group smoke test passed: +3 single, +12 group, idempotent retry, -12 group correction, validation rejections, and aggregate verification.',
);
