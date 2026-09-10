import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

// Deliberately no existing Worker config, .dev.vars, database or account is used.
// Every mutation targets a new local database under this run's private temp path.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiOrigin = 'http://localhost:8787';
const webOrigin = 'http://localhost:5173';
const basePath = '/million-beers-by-2035/';
const appUrl = `${webOrigin}${basePath}`;
const crewCode = 'synthetic-browser-crew-code';
const draftKey = 'million-beers:v1:entry-draft';
const sessionKey = 'million-beers-editor-session';
const work = await mkdtemp(path.join(tmpdir(), 'million-beers-browser-'));
const evidence = process.env.BROWSER_EVIDENCE_DIR
  ? path.resolve(process.env.BROWSER_EVIDENCE_DIR)
  : path.join(work, 'evidence');
const wrangler = path.join(repository, 'node_modules/wrangler/bin/wrangler.js');
const configPath = path.join(work, 'wrangler.json');
const statePath = path.join(work, 'state');
const buildPath = path.join(work, 'site');
const subprocesses = new Set();
const browsers = new Set();
let staticServer;
let logNumber = 0;

for (const [key, expected] of [
  ['BROWSER_API_URL', apiOrigin],
  ['BROWSER_APP_URL', appUrl],
]) {
  if (process.env[key] && process.env[key] !== expected)
    throw new Error(`${key} must equal the fixed local synthetic-test URL ${expected}.`);
}

const childEnv = {
  PATH: process.env.PATH ?? '',
  CI: '1',
  NO_COLOR: '1',
  XDG_CONFIG_HOME: path.join(work, 'config'),
  XDG_CACHE_HOME: path.join(work, 'cache'),
  WRANGLER_SEND_METRICS: 'false',
  CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  WRANGLER_LOG_PATH: path.join(work, 'wrangler.log'),
  ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  ...(process.env.PLAYWRIGHT_BROWSERS_PATH
    ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
    : {}),
  ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}),
};

function localOnly(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || ![apiOrigin, webOrigin].includes(url.origin))
    throw new Error(`Browser tests refuse a nonlocal endpoint: ${url.origin}`);
  return url;
}

async function localJson(route, init = {}) {
  const url = localOnly(`${apiOrigin}${route}`);
  const response = await fetch(url, { ...init, redirect: 'error' });
  assert(response.ok, `Local ${init.method ?? 'GET'} ${route} returned ${response.status}`);
  return response.json();
}

async function portMustBeFree(port) {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', () =>
      reject(
        new Error(
          `Port ${port} is already occupied. Stop your local development server before this isolated test.`,
        ),
      ),
    );
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}

function child(args, label, extraEnv = {}, cwd = work) {
  const processHandle = spawn(process.execPath, args, {
    cwd,
    env: { ...childEnv, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  subprocesses.add(processHandle);
  let output = '';
  processHandle.stdout.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-100_000);
  });
  processHandle.stderr.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-100_000);
  });
  const done = new Promise((resolve, reject) => {
    processHandle.once('error', reject);
    processHandle.once('close', async (code) => {
      subprocesses.delete(processHandle);
      await writeFile(path.join(work, `${++logNumber}-${label}.log`), output, { mode: 0o600 });
      resolve({ code, output });
    });
  });
  return { processHandle, done };
}

async function command(args, label, extraEnv = {}, cwd = work) {
  const result = await child(args, label, extraEnv, cwd).done;
  assert.equal(
    result.code,
    0,
    `${label} failed. Private diagnostic output:\n${result.output.slice(-10_000)}`,
  );
}

async function stop(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  const exited = once(processHandle, 'close');
  try {
    if (process.platform === 'win32') processHandle.kill('SIGTERM');
    else process.kill(-processHandle.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  const killTimer = setTimeout(() => {
    try {
      if (process.platform === 'win32') processHandle.kill('SIGKILL');
      else process.kill(-processHandle.pid, 'SIGKILL');
    } catch {
      /* Already exited. */
    }
  }, 5000);
  await exited;
  clearTimeout(killTimer);
}

async function waitReady(processHandle) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    assert.equal(processHandle.exitCode, null, 'The isolated Worker exited during startup.');
    try {
      const response = await fetch(`${apiOrigin}/ready`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response.json();
    } catch {
      /* The local listener may still be starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The isolated Worker did not become ready within 30 seconds.');
}

async function startWorker() {
  const running = child(
    [
      wrangler,
      'dev',
      '--config',
      configPath,
      '--local',
      '--persist-to',
      statePath,
      '--ip',
      '127.0.0.1',
      '--port',
      '8787',
      '--inspector-port',
      '0',
      '--show-interactive-dev-session=false',
      '--types=false',
      '--log-level',
      'warn',
    ],
    'worker',
  );
  return { ...running, ready: await waitReady(running.processHandle) };
}

async function serveBuiltSite() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
  };
  staticServer = createHttpServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', webOrigin);
      response.setHeader('X-Robots-Tag', 'noindex, nofollow');
      response.setHeader('Cache-Control', 'no-store');
      if (!url.pathname.startsWith(basePath)) {
        response.writeHead(404).end('Use the repository base path.');
        return;
      }
      const relative = decodeURIComponent(url.pathname.slice(basePath.length)) || 'index.html';
      const filename = path.resolve(buildPath, relative);
      if (!filename.startsWith(`${buildPath}${path.sep}`)) {
        response.writeHead(400).end('Invalid path.');
        return;
      }
      try {
        const data = await readFile(filename);
        response.setHeader(
          'Content-Type',
          types[path.extname(filename)] ?? 'application/octet-stream',
        );
        response.writeHead(200).end(data);
      } catch {
        response.writeHead(404).end('Not found.');
      }
    })().catch(() => response.writeHead(500).end('Local preview error.'));
  });
  await new Promise((resolve, reject) => {
    staticServer.once('error', reject);
    staticServer.listen(5173, '127.0.0.1', resolve);
  });
}

async function seed() {
  const session = await localJson('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: webOrigin },
    body: JSON.stringify({ code: crewCode }),
  });
  const headers = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
    Origin: webOrigin,
  };
  const members = [];
  for (let number = 1; number <= 15; number++) {
    const name = `Browser Person ${String(number).padStart(2, '0')}`;
    members.push(
      (
        await localJson('/api/members', {
          method: 'POST',
          headers,
          body: JSON.stringify({ displayName: name }),
        })
      ).member,
    );
    await localJson('/api/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: 1,
        contributor: name,
        note: 'Synthetic browser fixture only',
        idempotencyKey: crypto.randomUUID(),
      }),
    });
  }
  const saved = await localJson('/api/entries', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      totalAmount: 5,
      allocations: [
        { contributor: members[0].displayName, memberId: members[0].id, amount: 2 },
        { contributor: members[14].displayName, memberId: members[14].id, amount: 3 },
      ],
      note: 'Synthetic shared occasion',
      occurredAt: '2026-08-01T18:30:00-07:00',
      occurrenceTimezone: 'America/Los_Angeles',
      occurrencePrecision: 'minute',
      memory: {
        title: 'Browser seed gathering',
        venue: 'Synthetic Park',
        city: 'Fixture City',
        brewery: 'Synthetic Brewery',
      },
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  assert.equal(saved.stats.total, 20);
  assert.equal(saved.stats.entryCount, 16);
  return { members, entry: saved.entry };
}

async function navigate(page, route, heading) {
  await page.goto(`${appUrl}#/${route}`);
  await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  await page.evaluate(() => globalThis.document.fonts.ready);
}

async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    width: globalThis.window.innerWidth,
    content: globalThis.document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.content <= dimensions.width + 1,
    `${label} overflows horizontally: ${dimensions.content} > ${dimensions.width}`,
  );
}

async function openRecord(page) {
  await page
    .getByRole('button', { name: /^(Record entry|Resolve saved submission)$/ })
    .first()
    .click();
  await page.getByRole('dialog').waitFor();
  if (await page.getByRole('dialog', { name: 'Step behind the bar' }).isVisible())
    await loginDialog(page);
  await page.getByRole('dialog').waitFor();
}

async function loginDialog(page) {
  await page.getByLabel('Crew code', { exact: true }).fill(crewCode);
  await page.getByRole('button', { name: 'Unlock editor', exact: true }).click();
  await page.getByRole('dialog', { name: 'Step behind the bar' }).waitFor({ state: 'hidden' });
}

async function selectMember(page, label, name) {
  await page.getByLabel(label, { exact: true }).fill(name);
  await page.getByRole('button', { name: new RegExp(`${name}.*Select`, 'u') }).click();
}

async function submitAndCapture(page, button) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${apiOrigin}/api/entries` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: button, exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 201, 'A synthetic browser entry was not accepted.');
  const result = await response.json();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  return result;
}

async function assertHeroMatchesApi(page) {
  const summary = await localJson('/api/summary');
  await page.locator('#progress-heading').waitFor();
  await page.waitForFunction(
    (total) =>
      globalThis.document.getElementById('progress-heading')?.textContent?.replace(/,/gu, '') ===
      String(total),
    summary.stats.total,
  );
  return summary;
}

async function browserCase(engineName, engine, mobile, fixtures) {
  const label = `${engineName}-${mobile ? 'mobile' : 'desktop'}`;
  const browser = await engine.launch({ headless: true, env: childEnv });
  browsers.add(browser);
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    ...(engineName !== 'firefox' ? { isMobile: mobile } : {}),
    hasTouch: mobile,
    reducedMotion: 'reduce',
    timezoneId: 'America/Los_Angeles',
    colorScheme: 'dark',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const appErrors = [];
  const screenshotDiagnostics = [];
  const intentionalNetworkDiagnostics = [];
  const unexpectedNetwork = [];
  let stage = 'navigation';
  let capturingScreenshot = false;
  let intentionalResponseLoss = false;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      ![apiOrigin, webOrigin].includes(url.origin)
    ) {
      unexpectedNetwork.push(url.origin);
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  page.on('pageerror', (error) => appErrors.push({ stage, message: error.message }));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // WebKit's screenshot helper injects a temporary stylesheet. Record its
    // engine-only CSP diagnostic separately; never suppress normal app CSP errors.
    if (
      capturingScreenshot &&
      engineName === 'webkit' &&
      /Refused to apply (?:inline style|a stylesheet because its hash, its nonce, or 'unsafe-inline')/u.test(
        text,
      )
    ) {
      screenshotDiagnostics.push(text);
      return;
    }
    const source = message.location().url;
    if (
      intentionalResponseLoss &&
      stage === 'unknown-commit' &&
      (source === `${apiOrigin}/api/entries` || text.includes(`${apiOrigin}/api/entries`)) &&
      /Failed to load resource|net::ERR_FAILED|Load failed|CORS request did not succeed/u.test(text)
    ) {
      intentionalNetworkDiagnostics.push(text);
      return;
    }
    if (
      stage === 'missing-record' &&
      source.startsWith(`${apiOrigin}/api/entries`) &&
      /Failed to load resource|net::ERR_FAILED|Load failed/u.test(text)
    )
      return;
    appErrors.push({ stage, message: text, source });
  });
  page.on('requestfailed', (request) => {
    if (
      stage === 'unknown-commit' &&
      request.method() === 'POST' &&
      request.url() === `${apiOrigin}/api/entries`
    )
      return;
    if (request.failure()?.errorText.includes('ERR_ABORTED') && request.method() === 'GET') return;
    unexpectedNetwork.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
  });
  async function screenshot(name) {
    assert.deepEqual(appErrors, [], `${label}: application errors before screenshot`);
    await assertNoOverflow(page, `${label}/${name}`);
    capturingScreenshot = true;
    try {
      await page.screenshot({
        path: path.join(evidence, `${label}-${name}.png`),
        fullPage: true,
        caret: 'initial',
        animations: 'allow',
      });
      // Flush the screenshot helper's protocol events before ending its scope.
      await page.evaluate(() => true);
    } finally {
      capturingScreenshot = false;
    }
  }
  try {
    await page.goto(appUrl);
    const before = await assertHeroMatchesApi(page);
    await screenshot('dashboard');
    for (const [route, heading] of [
      ['crew', 'People behind the memories'],
      ['history', 'The shared history'],
      ['recaps', 'Recaps'],
      ['about', 'An impossible number. Real time together.'],
    ]) {
      await navigate(page, route, heading);
      await assertNoOverflow(page, `${label}/${route}`);
    }
    await navigate(page, `entry/${fixtures.entry.id}`, 'Browser seed gathering');
    await page.getByText('Synthetic Park', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Browser seed gathering', exact: true }).waitFor();
    await screenshot('entry');
    await page.getByRole('link', { name: 'Browser Person 15', exact: true }).click();
    await page.getByRole('heading', { name: 'Browser Person 15', exact: true }).waitFor();
    await page.goBack();
    await page.getByRole('heading', { name: 'Browser seed gathering', exact: true }).waitFor();
    await page.goForward();
    await page.getByRole('heading', { name: 'Browser Person 15', exact: true }).waitFor();
    await navigate(page, 'crew', 'People behind the memories');
    await page
      .getByLabel('Find a display name or alias', { exact: true })
      .fill('Browser Person 14');
    await page.getByRole('button', { name: 'Search crew', exact: true }).click();
    await page.getByRole('heading', { name: 'Browser Person 14', exact: true }).waitFor();
    stage = 'missing-record';
    for (const missing of ['not-a-real-entry', '%E0%A4%A']) {
      await navigate(page, `entry/${missing}`, 'This page could not be loaded');
      await page
        .getByText('Entry not found.', { exact: true })
        .or(page.getByText('Not found.', { exact: true }))
        .waitFor();
    }
    stage = 'single-entry';
    await page.goto(appUrl);
    await assertHeroMatchesApi(page);
    await openRecord(page);
    await selectMember(page, 'Contributor / nickname', 'Browser Person 14');
    await page.getByLabel('Custom amount', { exact: true }).fill('2');
    await page.getByLabel('Note (optional)', { exact: true }).fill(`Synthetic ${label} single`);
    await submitAndCapture(page, 'Record +2 beers');
    assert.equal((await assertHeroMatchesApi(page)).stats.total, before.stats.total + 2);

    stage = 'keyboard-dialog';
    const keyboardOpener = page.getByRole('button', { name: 'Record entry', exact: true }).first();
    // Open via the keyboard: Safari pointer clicks intentionally do not focus
    // buttons, so a pointer click cannot establish a keyboard return target.
    await keyboardOpener.focus();
    await keyboardOpener.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
    await page.waitForFunction(() =>
      globalThis.document
        .querySelector('[role="dialog"]')
        ?.contains(globalThis.document.activeElement),
    );
    await page.keyboard.press('Shift+Tab');
    assert(
      await dialog.evaluate((element) => element.contains(globalThis.document.activeElement)),
      'Keyboard focus escaped the open dialog.',
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert(
      await keyboardOpener.evaluate((element) => globalThis.document.activeElement === element),
      'Closing the dialog did not restore focus to its opener.',
    );

    stage = 'group-entry';
    await openRecord(page);
    await page.getByRole('button', { name: 'Split between people', exact: true }).click();
    await selectMember(page, 'Person 1', 'Browser Person 12');
    await selectMember(page, 'Person 2', 'Browser Person 13');
    await page.getByLabel('Total beers', { exact: true }).fill('5');
    await page.getByLabel('Beer allocation for participant 1', { exact: true }).fill('2');
    await page.getByLabel('Beer allocation for participant 2', { exact: true }).fill('3');
    await page
      .getByLabel('Shared note (optional)', { exact: true })
      .fill(`Synthetic ${label} group`);
    await page.getByText('Add a memory or occurrence date', { exact: true }).click();
    await page.getByLabel('Occasion title (optional)', { exact: true }).fill(`${label} gathering`);
    await page.getByRole('button', { name: 'Review group entry', exact: true }).click();
    await screenshot('group-review');
    const group = await submitAndCapture(page, 'Confirm entry');
    assert.deepEqual(
      group.entry.allocations.map((allocation) => allocation.amount),
      [2, 3],
    );
    assert.equal((await assertHeroMatchesApi(page)).stats.total, before.stats.total + 7);

    stage = 'linked-correction';
    await navigate(page, `entry/${group.entry.id}`, `${label} gathering`);
    await page.getByRole('button', { name: 'Correct this entry', exact: true }).click();
    await page.getByLabel('Beer allocation for participant 1', { exact: true }).fill('1');
    await page.getByLabel('Beer allocation for participant 2', { exact: true }).fill('0');
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill(`Synthetic ${label} partial correction`);
    await page.getByRole('button', { name: 'Review group correction', exact: true }).click();
    const correction = await submitAndCapture(page, 'Confirm correction');
    assert.equal(correction.entry.correctionOfEntryId, group.entry.id);
    assert.equal(correction.entry.totalAmount, -1);
    assert.equal(correction.entry.allocations.length, 1);
    const corrected = await localJson(`/api/entries/${group.entry.id}`);
    assert.deepEqual(
      corrected.entry.allocations.map((allocation) => allocation.remainingCorrectable),
      [1, 3],
    );
    await page.goto(appUrl);
    assert.equal((await assertHeroMatchesApi(page)).stats.total, before.stats.total + 6);

    stage = 'unknown-commit';
    let originalPayload;
    let replayPayload;
    let originalResult;
    let replayResult;
    await context.route(`${apiOrigin}/api/entries`, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      localOnly(route.request().url());
      const payload = route.request().postDataJSON();
      const response = await route.fetch({ maxRedirects: 0 });
      if (!originalPayload) {
        originalPayload = payload;
        assert.equal(response.status(), 201);
        originalResult = await response.json();
        // The real Worker/D1 committed, but the browser receives no response.
        intentionalResponseLoss = true;
        await route.abort('failed');
      } else {
        intentionalResponseLoss = false;
        replayPayload = payload;
        assert.equal(response.status(), 200);
        replayResult = await response.json();
        await route.fulfill({ response });
      }
    });
    await openRecord(page);
    await page.getByLabel('Custom amount', { exact: true }).fill('2');
    await selectMember(page, 'Contributor / nickname', 'Browser Person 11');
    await page
      .getByLabel('Note (optional)', { exact: true })
      .fill(`Synthetic ${label} committed timeout`);
    await page.getByRole('button', { name: 'Record +2 beers', exact: true }).click();
    await page.getByRole('button', { name: 'Retry saved attempt', exact: true }).waitFor();
    const persisted = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
      draftKey,
    );
    assert.deepEqual(persisted.attempt.payload, originalPayload);
    await page.getByRole('button', { name: 'Keep and close', exact: true }).click();
    // Reauthentication is real; remove only this synthetic browser's test session.
    await page.evaluate((key) => sessionStorage.removeItem(key), sessionKey);
    await page.reload();
    await assertHeroMatchesApi(page);
    await openRecord(page);
    await page.getByRole('button', { name: 'Retry saved attempt', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(
      replayPayload,
      originalPayload,
      'Retry changed a durable payload or idempotency key.',
    );
    assert.equal(replayResult.idempotent, true);
    assert.equal(replayResult.entry.id, originalResult.entry.id);
    const after = await assertHeroMatchesApi(page);
    assert.equal(after.stats.total, before.stats.total + 8);
    assert.equal(after.stats.entryCount, before.stats.entryCount + 4);
    assert.equal(after.stats.allocationCount, before.stats.allocationCount + 5);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), draftKey), null);
    await context.unroute(`${apiOrigin}/api/entries`);
    stage = 'completed';
    assert.deepEqual(appErrors, [], `${label}: application console/page errors`);
    assert.deepEqual(
      unexpectedNetwork,
      [],
      `${label}: unexpected network failures or remote requests`,
    );
    await screenshot('after-writes');
    return {
      browser: engineName,
      viewport: mobile ? '390x844 touch emulation' : '1440x1000 desktop',
      status: 'passed',
      scenarios: [
        'navigation',
        'base-path-reload',
        'back-forward',
        'directory-beyond-leaderboard',
        'missing-malformed-record',
        'login',
        'single-entry',
        'keyboard-dialog-focus',
        'exact-group-entry',
        'linked-partial-correction',
        'commit-response-loss',
        'durable-reload',
        'reauthentication',
        'exact-idempotent-retry',
        'canonical-total',
      ],
      screenshotOnlyDiagnostics: screenshotDiagnostics.length,
      intentionalResponseLossDiagnostics: intentionalNetworkDiagnostics.length,
      physicalDevice: false,
    };
  } catch (error) {
    await writeFile(
      path.join(evidence, `${label}-failure.json`),
      JSON.stringify({ stage, message: error.message, appErrors, unexpectedNetwork }, null, 2),
      { mode: 0o600 },
    );
    throw error;
  } finally {
    await context.close();
    await browser.close();
    browsers.delete(browser);
  }
}

const report = {
  data: 'synthetic local fixtures only',
  app: appUrl,
  api: apiOrigin,
  hostedPreview: false,
  physicalDevices: false,
  cases: [],
};
try {
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  await mkdir(childEnv.XDG_CONFIG_HOME, { recursive: true, mode: 0o700 });
  await portMustBeFree(8787);
  await portMustBeFree(5173);
  await writeFile(
    configPath,
    JSON.stringify(
      {
        name: 'million-beers-browser-synthetic',
        main: path.join(repository, 'apps/api/src/index.ts'),
        compatibility_date: '2026-07-24',
        workers_dev: false,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'browser-synthetic',
            database_id: '00000000-0000-4000-8000-000000000001',
            migrations_dir: path.join(repository, 'apps/api/migrations'),
            remote: false,
          },
        ],
        vars: {
          ALLOWED_ORIGINS: webOrigin,
          CHALLENGE_TARGET: '1000000',
          CHALLENGE_START_ISO: '2026-07-24T00:00:00-07:00',
          CHALLENGE_DEADLINE_ISO: '2035-01-01T00:00:00-08:00',
          CHALLENGE_TIMEZONE: 'America/Los_Angeles',
          SESSION_TTL_SECONDS: '43200',
          LOGIN_RATE_LIMIT_MAX: '1000',
          LOGIN_RATE_LIMIT_WINDOW_SECONDS: '900',
          MUTATION_RATE_LIMIT_MAX: '1000',
          MUTATION_RATE_LIMIT_WINDOW_SECONDS: '600',
          BEER_ADMIN_PIN: crewCode,
          SESSION_SIGNING_SECRET: 'synthetic-browser-session-signing-value-no-production-access',
          RATE_LIMIT_SALT: 'synthetic-browser-rate-limit-value-no-production-access',
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await command(
    [
      wrangler,
      'd1',
      'migrations',
      'apply',
      'browser-synthetic',
      '--config',
      configPath,
      '--local',
      '--persist-to',
      statePath,
    ],
    'migrate',
  );
  let running = await startWorker();
  assert.equal(running.ready.capabilities.enhancedLogging, false);
  const empty = await localJson('/api/summary');
  assert.equal(empty.stats.total, 0, 'The browser fixture database was not empty.');
  assert.equal(empty.stats.entryCount, 0);
  await stop(running.processHandle);
  await command(
    [
      wrangler,
      'd1',
      'execute',
      'browser-synthetic',
      '--config',
      configPath,
      '--local',
      '--persist-to',
      statePath,
      '--command',
      'UPDATE upgrade_state SET mutations_enabled = 1 WHERE id = 1',
    ],
    'enable-synthetic',
  );
  running = await startWorker();
  assert.equal(running.ready.capabilities.enhancedLogging, true);
  const fixtures = await seed();
  await command(
    [
      path.join(repository, 'node_modules/vite/bin/vite.js'),
      'build',
      '--outDir',
      buildPath,
      '--emptyOutDir',
    ],
    'build-web',
    {
      VITE_API_BASE_URL: apiOrigin,
      VITE_BASE_PATH: basePath,
      VITE_RELEASE_SHA: 'synthetic-browser-test',
    },
    path.join(repository, 'apps/web'),
  );
  assert((await stat(path.join(buildPath, 'index.html'))).isFile());
  await serveBuiltSite();
  assert.equal((await fetch(appUrl)).headers.get('X-Robots-Tag'), 'noindex, nofollow');
  for (const [name, engine] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    for (const mobile of [false, true]) {
      process.stdout.write(
        `Browser verification: ${name} ${mobile ? 'mobile emulation' : 'desktop'}\n`,
      );
      report.cases.push(await browserCase(name, engine, mobile, fixtures));
    }
  }
  const finalSummary = await localJson('/api/summary');
  report.final = {
    total: finalSummary.stats.total,
    entries: finalSummary.stats.entryCount,
    allocations: finalSummary.stats.allocationCount,
    revision: finalSummary.revision,
  };
  report.status = 'passed';
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({ status: 'passed', cases: report.cases.length, evidence })}\n`,
  );
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  process.stderr.write(
    `Browser verification failed: ${error.message}\nPrivate evidence: ${evidence}\nPrivate runtime diagnostics: ${work}\n`,
  );
  process.exitCode = 1;
} finally {
  for (const browser of browsers) await browser.close();
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
  await Promise.all([...subprocesses].map(stop));
}
