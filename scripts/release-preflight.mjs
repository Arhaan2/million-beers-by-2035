import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { apiSourceTag } from './api-source-tag.mjs';

// Diagnostics only: no login, migration, secret, capability or deploy command.
const api = process.env.API_BASE_URL ?? 'https://million-beers-api.arhaan2.workers.dev';
const site = process.env.SITE_BASE_URL ?? 'https://arhaan2.github.io/million-beers-by-2035/';
async function read(url) {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { value: await response.json() };
  } catch {
    return {
      error: 'Unavailable: network, timeout or invalid JSON. Retry this read-only preflight.',
    };
  }
}
const [readyResult, publishedResult, expected, migrations] = await Promise.all([
  read(`${api.replace(/\/$/u, '')}/ready`),
  read(new URL('release.json', site)),
  apiSourceTag(),
  readdir(new URL('../apps/api/migrations/', import.meta.url)),
]);
const ready = readyResult.value;
const compatible =
  ready?.ok === true &&
  ready?.service === 'million-beers-api' &&
  ready?.schemaVersion === 3 &&
  ready?.capabilities?.crew === true &&
  ready?.capabilities?.history === true;
const tagMatches = ready?.release === expected;
const report = {
  checkedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeClean:
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '',
  expectedApiTag: expected,
  backend: {
    status:
      readyResult.error ??
      (compatible
        ? 'Compatible public schema and read capabilities'
        : 'Incompatible or malformed readiness'),
    release: typeof ready?.release === 'string' ? ready.release : null,
    schemaVersion: Number.isInteger(ready?.schemaVersion) ? ready.schemaVersion : null,
    revision: Number.isSafeInteger(ready?.revision) ? ready.revision : null,
    tagMatches,
    capabilities: Object.fromEntries(
      [
        'crew',
        'history',
        'memories',
        'enhancedLogging',
        'memberCreation',
        'occurrence',
        'linkedCorrections',
        'metadataEditing',
        'photos',
        'strongIdentity',
      ].map((key) => [key, ready?.capabilities?.[key] === true]),
    ),
  },
  frontend: {
    status:
      publishedResult.error ??
      (typeof publishedResult.value?.commit === 'string'
        ? 'Published commit observed'
        : 'Malformed public release metadata'),
    commit: typeof publishedResult.value?.commit === 'string' ? publishedResult.value.commit : null,
  },
  migrations: {
    repository: migrations.filter((name) => /^\d+.*\.sql$/u.test(name)).sort(),
    remote:
      'Not queried. Use --remote-migrations with existing owner authorization to inspect pending migrations.',
  },
  readyForPages: compatible && tagMatches,
};
if (process.argv.includes('--remote-migrations')) {
  try {
    // Wrangler prints only migration names/status here. Never echo auth logs.
    const output = execFileSync(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'd1',
        'migrations',
        'list',
        'million-beers-production',
        '--remote',
        '--config',
        'apps/api/wrangler.jsonc',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
    );
    const pending = output.match(/\b\d{4}_[a-zA-Z0-9_-]+\.sql\b/gu);
    report.migrations.remote = /No migrations to apply/iu.test(output)
      ? 'No pending migrations reported by Wrangler.'
      : pending?.length
        ? `Pending: ${[...new Set(pending)].join(', ')}`
        : 'Remote command completed; status could not be parsed. Inspect Wrangler directly.';
  } catch {
    report.migrations.remote =
      'Unavailable. Check owner authorization with wrangler whoami; no changes were made.';
  }
}
console.log(JSON.stringify(report, null, 2));
if (
  !report.readyForPages ||
  report.frontend.commit === null ||
  (process.argv.includes('--remote-migrations') &&
    report.migrations.remote.startsWith('Unavailable'))
)
  process.exitCode = 1;
