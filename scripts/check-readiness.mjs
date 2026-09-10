import { apiSourceTag } from './api-source-tag.mjs';

const expected = await apiSourceTag();
const base = process.env.API_BASE_URL ?? 'https://million-beers-api.arhaan2.workers.dev';
try {
  const response = await fetch(`${base}/ready`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Backend readiness endpoint is unavailable.');
  const ready = await response.json().catch(() => {
    throw new Error('Backend readiness response must be valid JSON.');
  });
  if (
    !ready ||
    typeof ready !== 'object' ||
    Array.isArray(ready) ||
    ready.ok !== true ||
    ready.service !== 'million-beers-api' ||
    !Number.isInteger(ready.schemaVersion) ||
    ready.schemaVersion !== 3
  ) {
    throw new Error('Backend database/schema readiness has not passed.');
  }
  if (ready.release !== expected) {
    throw new Error('Deployed backend source does not match this reviewed candidate.');
  }
  if (!['crew', 'history'].every((key) => ready.capabilities?.[key] === true)) {
    throw new Error('Required backend read capabilities are unavailable.');
  }
  console.log(`Backend readiness verified for ${expected}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backend readiness check failed.');
  process.exitCode = 1;
}
