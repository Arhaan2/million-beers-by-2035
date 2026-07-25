import type { RequestContext } from './types';

const permissionsPolicy =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

export class ApiError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly category: string;

  constructor(status: number, publicMessage: string, category = 'request_error') {
    super(publicMessage);
    this.name = 'ApiError';
    this.status = status;
    this.publicMessage = publicMessage;
    this.category = category;
  }
}

export function secureHeaders(context: RequestContext, cacheControl = 'no-store'): Headers {
  const headers = new Headers({
    'Cache-Control': cacheControl,
    'Content-Type': 'application/json; charset=utf-8',
    'Permissions-Policy': permissionsPolicy,
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Request-ID': context.requestId,
  });

  if (context.corsOrigin) {
    headers.set('Access-Control-Allow-Origin', context.corsOrigin);
  }
  return headers;
}

export function jsonResponse(
  value: unknown,
  context: RequestContext,
  init: { status?: number; cacheControl?: string; extraHeaders?: HeadersInit } = {},
): Response {
  const headers = secureHeaders(context, init.cacheControl);
  if (init.extraHeaders) {
    new Headers(init.extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  const status = init.status ?? 200;
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers,
  });
}

export function errorResponse(error: ApiError, context: RequestContext): Response {
  return jsonResponse({ error: error.publicMessage, requestId: context.requestId }, context, {
    status: error.status,
  });
}
