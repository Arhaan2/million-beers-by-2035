import { ApiError } from './responses';
import type { SessionPayload } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url');
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacKey(secret),
    encoder.encode(value),
  );
  return new Uint8Array(signature);
}

export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function compareCrewCode(actual: string, expected: string): Promise<boolean> {
  const [actualHash, expectedHash] = await Promise.all([sha256(actual), sha256(expected)]);
  return timingSafeEqual(actualHash, expectedHash);
}

export async function createSessionToken(
  secret: string,
  ttlSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number; payload: SessionPayload }> {
  const payload: SessionPayload = {
    v: 1,
    scope: 'editor',
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = bytesToBase64Url(await hmac(encodedPayload, secret));
  return { token: `${encodedPayload}.${signature}`, expiresAt: payload.exp, payload };
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    candidate.scope === 'editor' &&
    typeof candidate.iat === 'number' &&
    Number.isInteger(candidate.iat) &&
    typeof candidate.exp === 'number' &&
    Number.isInteger(candidate.exp) &&
    typeof candidate.jti === 'string' &&
    /^[0-9a-f-]{36}$/iu.test(candidate.jti)
  );
}

export async function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, encodedSignature] = parts;
    if (!encodedPayload || !encodedSignature) return null;
    const expectedSignature = await hmac(encodedPayload, secret);
    const suppliedSignature = base64UrlToBytes(encodedSignature);
    if (!timingSafeEqual(expectedSignature, suppliedSignature)) return null;
    const parsed: unknown = JSON.parse(decoder.decode(base64UrlToBytes(encodedPayload)));
    if (!isSessionPayload(parsed)) return null;
    if (parsed.exp <= nowSeconds || parsed.iat > nowSeconds + 60) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function requireEditorSession(request: Request, env: Env): Promise<SessionPayload> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new ApiError(401, 'A valid editor session is required.', 'missing_authorization');
  }
  const token = authorization.slice('Bearer '.length).trim();
  const payload = await verifySessionToken(token, env.SESSION_SIGNING_SECRET);
  if (!payload) throw new ApiError(401, 'Editor session is invalid or expired.', 'invalid_session');
  return payload;
}

export async function stableHash(value: string, salt: string): Promise<string> {
  return bytesToBase64Url(await sha256(`${salt}:${value}`));
}
