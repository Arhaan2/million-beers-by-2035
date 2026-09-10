import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { apiSourceTag } from './api-source-tag.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const release = await apiSourceTag();
const healthy = {
  ok: true,
  service: 'million-beers-api',
  schemaVersion: 3,
  release,
  capabilities: { crew: true, history: true },
};

async function runGate(body, status = 200, raw = false) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(raw ? body : JSON.stringify(body));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  try {
    let result;
    try {
      result = {
        ...(await execute(process.execPath, ['scripts/check-readiness.mjs'], {
          cwd: repository,
          // The child receives no credentials or production endpoint override.
          env: { API_BASE_URL: `http://127.0.0.1:${address.port}` },
          timeout: 20_000,
        })),
        code: 0,
      };
    } catch (error) {
      result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
    assert.deepEqual(requests, [{ method: 'GET', path: '/ready' }]);
    return result;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

await test('actual release gate accepts the exact source tag and supported ready schema', async () => {
  const result = await runGate(healthy);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Backend readiness verified/u);
  assert(result.stdout.includes(release));
  assert.equal(result.stderr, '');
});

for (const [label, body] of [
  ['false readiness', { ...healthy, ok: false }],
  ['string readiness', { ...healthy, ok: 'false' }],
  ['missing readiness', { ...healthy, ok: undefined }],
  ['missing schema', { ...healthy, schemaVersion: undefined }],
  ['null schema', { ...healthy, schemaVersion: null }],
  ['string schema', { ...healthy, schemaVersion: '3' }],
  ['fractional schema', { ...healthy, schemaVersion: 3.5 }],
  ['older schema', { ...healthy, schemaVersion: 2 }],
  ['unknown newer schema', { ...healthy, schemaVersion: 4 }],
  ['wrong service', { ...healthy, service: 'unrelated-service' }],
  ['wrong source tag', { ...healthy, release: 'crew-unreviewed-source' }],
  ['missing source tag', { ...healthy, release: undefined }],
  ['missing capabilities', { ...healthy, capabilities: undefined }],
  ['disabled history', { ...healthy, capabilities: { crew: true, history: false } }],
  ['string capability', { ...healthy, capabilities: { crew: 'true', history: true } }],
  ['null response', null],
  ['array response', []],
]) {
  await test(`actual release gate rejects ${label}`, async () => {
    const result = await runGate(body);
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stdout, /verified/u);
    assert(result.stderr.length > 0);
  });
}

await test('actual release gate rejects an unsuccessful HTTP status even with healthy JSON', async () => {
  const result = await runGate(healthy, 503);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /endpoint is unavailable/u);
});

await test('actual release gate rejects invalid JSON without printing response contents', async () => {
  const result = await runGate('synthetic-private-diagnostic', 200, true);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must be valid JSON/u);
  assert.doesNotMatch(result.stderr, /synthetic-private-diagnostic/u);
});
