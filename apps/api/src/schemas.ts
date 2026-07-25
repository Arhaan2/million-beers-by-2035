import { ApiError } from './responses';
import type { EventInput } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BODY_BYTES = 16 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new ApiError(415, 'Content-Type must be application/json.', 'invalid_content_type');
  }
  const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ApiError(413, 'Request body is too large.', 'body_too_large');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, 'Request body is too large.', 'body_too_large');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.', 'invalid_json');
  }
}

export function parseLoginBody(value: unknown): string {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    value.code.length < 1 ||
    value.code.length > 64
  ) {
    throw new ApiError(400, 'A crew code is required.', 'invalid_login_body');
  }
  return value.code;
}

function normalizeContributor(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Anonymous';
  if (typeof value !== 'string')
    throw new ApiError(400, 'Contributor must be text.', 'invalid_event');
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized) return 'Anonymous';
  if ([...normalized].length > 30) {
    throw new ApiError(400, 'Contributor must be 30 characters or fewer.', 'invalid_event');
  }
  return normalized;
}

function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ApiError(400, 'Note must be text.', 'invalid_event');
  const note = value.trim();
  if (!note) return null;
  if ([...note].length > 140) {
    throw new ApiError(400, 'Note must be 140 characters or fewer.', 'invalid_event');
  }
  return note;
}

export function parseEventBody(value: unknown): EventInput {
  if (!isRecord(value)) throw new ApiError(400, 'Invalid event payload.', 'invalid_event');
  const { amount, idempotencyKey } = value;
  if (
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount === 0 ||
    amount < -250 ||
    amount > 250
  ) {
    throw new ApiError(
      400,
      'Amount must be a nonzero integer from -250 through 250.',
      'invalid_event',
    );
  }
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey)) {
    throw new ApiError(400, 'A valid idempotency key is required.', 'invalid_event');
  }
  const contributor = normalizeContributor(value.contributor);
  const note = normalizeNote(value.note);
  if (amount < 0 && (!note || [...note].length < 4)) {
    throw new ApiError(
      400,
      'Corrections require a reason of at least 4 characters.',
      'invalid_event',
    );
  }
  return { amount, contributor, note, idempotencyKey };
}
