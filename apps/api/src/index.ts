import { compareCrewCode, createSessionToken, requireEditorSession, stableHash } from './auth';
import { assertAllowedBrowserOrigin, getAllowedOrigin, optionsResponse } from './cors';
import { createBeerEntry, getSummary, recordEvent } from './database';
import { cleanExpiredRateLimits, clearRateLimit, consumeRateLimit } from './rateLimit';
import { ApiError, errorResponse, jsonResponse } from './responses';
import { parseEntryBody, parseEventBody, parseLoginBody, readJsonBody } from './schemas';
import type { RequestContext } from './types';

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clientAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local-development';
}

async function handleLogin(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
  context: RequestContext,
): Promise<Response> {
  assertAllowedBrowserOrigin(request, env);
  const ipHash = await stableHash(clientAddress(request), env.RATE_LIMIT_SALT);
  const maximum = positiveInteger(env.LOGIN_RATE_LIMIT_MAX, 5);
  const windowSeconds = positiveInteger(env.LOGIN_RATE_LIMIT_WINDOW_SECONDS, 900);
  const limit = await consumeRateLimit(env.DB, 'login', ipHash, maximum, windowSeconds);
  if (!limit.allowed)
    throw new ApiError(429, 'Too many login attempts. Try again later.', 'login_limited');

  const code = parseLoginBody(await readJsonBody(request));
  if (!(await compareCrewCode(code, env.BEER_ADMIN_PIN))) {
    throw new ApiError(401, 'Invalid crew code.', 'invalid_crew_code');
  }

  await clearRateLimit(env.DB, 'login', ipHash);
  const session = await createSessionToken(
    env.SESSION_SIGNING_SECRET,
    positiveInteger(env.SESSION_TTL_SECONDS, 43_200),
  );
  executionContext.waitUntil(
    cleanExpiredRateLimits(env.DB, Math.floor(Date.now() / 1000) - 86_400).catch(() => undefined),
  );
  return jsonResponse({ token: session.token, expiresAt: session.expiresAt }, context);
}

async function handleSession(
  request: Request,
  env: Env,
  context: RequestContext,
): Promise<Response> {
  const session = await requireEditorSession(request, env);
  return jsonResponse({ valid: true, expiresAt: session.exp }, context);
}

async function authorizeMutation(request: Request, env: Env): Promise<string> {
  assertAllowedBrowserOrigin(request, env);
  const session = await requireEditorSession(request, env);
  const mutationKey = await stableHash(
    `${clientAddress(request)}:${session.jti}`,
    env.RATE_LIMIT_SALT,
  );
  const limit = await consumeRateLimit(
    env.DB,
    'mutation',
    mutationKey,
    positiveInteger(env.MUTATION_RATE_LIMIT_MAX, 30),
    positiveInteger(env.MUTATION_RATE_LIMIT_WINDOW_SECONDS, 600),
  );
  if (!limit.allowed)
    throw new ApiError(429, 'Too many updates. Try again later.', 'mutation_limited');
  return stableHash(session.jti, env.RATE_LIMIT_SALT);
}

async function handleEvent(request: Request, env: Env, context: RequestContext): Promise<Response> {
  const sessionFingerprint = await authorizeMutation(request, env);
  const input = parseEventBody(await readJsonBody(request));
  const result = await recordEvent(env, input, sessionFingerprint);
  return jsonResponse(result, context, { status: result.idempotent ? 200 : 201 });
}

async function handleEntry(request: Request, env: Env, context: RequestContext): Promise<Response> {
  const sessionFingerprint = await authorizeMutation(request, env);
  const input = parseEntryBody(await readJsonBody(request));
  const result = await createBeerEntry(env, input, sessionFingerprint);
  return jsonResponse(result, context, { status: result.idempotent ? 200 : 201 });
}

async function route(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
  context: RequestContext,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === 'OPTIONS') return optionsResponse(request, env, context);
  if (request.method === 'GET' && pathname === '/health') {
    return jsonResponse({ ok: true, service: 'million-beers-api' }, context);
  }
  if (request.method === 'GET' && pathname === '/api/summary') {
    return jsonResponse(await getSummary(env), context, { cacheControl: 'public, max-age=10' });
  }
  if (request.method === 'POST' && pathname === '/api/login') {
    return handleLogin(request, env, executionContext, context);
  }
  if (request.method === 'GET' && pathname === '/api/session') {
    return handleSession(request, env, context);
  }
  if (request.method === 'POST' && pathname === '/api/events') {
    return handleEvent(request, env, context);
  }
  if (request.method === 'POST' && pathname === '/api/entries') {
    return handleEntry(request, env, context);
  }
  throw new ApiError(404, 'Not found.', 'not_found');
}

export default {
  async fetch(request, env, executionContext): Promise<Response> {
    const requestId = crypto.randomUUID();
    const context: RequestContext = {
      requestId,
      corsOrigin: getAllowedOrigin(request, env),
    };
    try {
      return await route(request, env, executionContext, context);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error, context);
      console.error(JSON.stringify({ requestId, category: 'unexpected_error' }));
      return errorResponse(
        new ApiError(500, 'An unexpected error occurred.', 'unexpected_error'),
        context,
      );
    }
  },
} satisfies ExportedHandler<Env>;
