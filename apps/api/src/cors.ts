import { ApiError, jsonResponse } from './responses';
import type { RequestContext } from './types';

export function getAllowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const allowed = new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowed.has(origin) ? origin : null;
}

export function assertAllowedBrowserOrigin(request: Request, env: Env): void {
  const origin = request.headers.get('Origin');
  if (origin && getAllowedOrigin(request, env) !== origin) {
    throw new ApiError(403, 'Origin is not allowed.', 'cors_rejected');
  }
}

export function optionsResponse(request: Request, env: Env, context: RequestContext): Response {
  const requestedOrigin = request.headers.get('Origin');
  if (!requestedOrigin || getAllowedOrigin(request, env) !== requestedOrigin) {
    return jsonResponse({ error: 'Origin is not allowed.' }, context, { status: 403 });
  }

  return jsonResponse(
    null,
    { ...context, corsOrigin: requestedOrigin },
    {
      status: 204,
      extraHeaders: {
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
      },
    },
  );
}
