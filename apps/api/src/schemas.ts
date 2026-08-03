import { ApiError } from './responses';
import type { AllocationInput, EntryInput, EventInput } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BODY_BYTES = 16 * 1024;
export const ANONYMOUS_CONTRIBUTOR = 'Anonymous';

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

function normalizeContributor(value: unknown, allowAnonymous = true): string {
  if (value === undefined || value === null || value === '') {
    if (allowAnonymous) return ANONYMOUS_CONTRIBUTOR;
    throw new ApiError(400, 'Every group participant needs a name.', 'invalid_entry');
  }
  if (typeof value !== 'string')
    throw new ApiError(400, 'Contributor must be text.', 'invalid_event');
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized) {
    if (allowAnonymous) return ANONYMOUS_CONTRIBUTOR;
    throw new ApiError(400, 'Every group participant needs a name.', 'invalid_entry');
  }
  if ([...normalized].length > 30) {
    throw new ApiError(400, 'Contributor must be 30 characters or fewer.', 'invalid_event');
  }
  return normalized;
}

export function normalizeContributorKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('en-US');
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

function parseAllocation(value: unknown, groupMode: boolean): AllocationInput {
  if (!isRecord(value)) {
    throw new ApiError(
      400,
      'Every allocation must include a participant and amount.',
      'invalid_entry',
    );
  }
  const contributor = normalizeContributor(value.contributor, !groupMode);
  const amount = value.amount;
  if (
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount === 0 ||
    amount < -250 ||
    amount > 250
  ) {
    throw new ApiError(
      400,
      'Every allocation must be a nonzero integer from -250 through 250.',
      'invalid_entry',
    );
  }
  return { contributor, contributorKey: normalizeContributorKey(contributor), amount };
}

export function parseEntryBody(value: unknown): EntryInput {
  if (!isRecord(value)) throw new ApiError(400, 'Invalid entry payload.', 'invalid_entry');
  const { totalAmount, idempotencyKey } = value;
  if (
    typeof totalAmount !== 'number' ||
    !Number.isInteger(totalAmount) ||
    totalAmount === 0 ||
    totalAmount < -250 ||
    totalAmount > 250
  ) {
    throw new ApiError(
      400,
      'Total amount must be a nonzero integer from -250 through 250.',
      'invalid_entry',
    );
  }
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey)) {
    throw new ApiError(400, 'A valid idempotency key is required.', 'invalid_entry');
  }
  if (!Array.isArray(value.allocations) || value.allocations.length === 0) {
    throw new ApiError(400, 'At least one allocation is required.', 'invalid_entry');
  }
  if (value.allocations.length > 25) {
    throw new ApiError(400, 'An entry can include at most 25 participants.', 'invalid_entry');
  }

  const groupMode = value.allocations.length > 1;
  const allocations = value.allocations.map((allocation) => parseAllocation(allocation, groupMode));
  const expectedSign = Math.sign(totalAmount);
  if (allocations.some((allocation) => Math.sign(allocation.amount) !== expectedSign)) {
    throw new ApiError(
      400,
      'Every allocation must use the same sign as the entry total.',
      'invalid_entry',
    );
  }
  const allocationTotal = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (allocationTotal !== totalAmount) {
    throw new ApiError(400, 'Allocations must add up to the entry total exactly.', 'invalid_entry');
  }
  const contributorKeys = new Set<string>();
  for (const allocation of allocations) {
    if (contributorKeys.has(allocation.contributorKey)) {
      throw new ApiError(
        400,
        'Each participant may appear only once in an entry.',
        'duplicate_contributor',
      );
    }
    contributorKeys.add(allocation.contributorKey);
  }

  const note = normalizeNote(value.note);
  if (totalAmount < 0 && (!note || [...note].length < 4)) {
    throw new ApiError(
      400,
      'Corrections require a reason of at least 4 characters.',
      'invalid_entry',
    );
  }
  return { totalAmount, allocations, note, idempotencyKey };
}
