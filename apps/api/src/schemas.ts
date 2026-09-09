import { ApiError } from './responses';
import type { AllocationInput, EntryInput, EventInput, MemoryInput } from './types';

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

export function normalizeContributor(value: unknown, allowAnonymous = true): string {
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
  if ([...normalizeContributorKey(normalized)].length > 30) {
    throw new ApiError(
      400,
      'Contributor must normalize to 30 characters or fewer.',
      'invalid_event',
    );
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
  const memberId = optionalId(value.memberId);
  const sourceAllocationId = optionalId(value.sourceAllocationId);
  const contributor = normalizeContributor(
    value.contributor,
    !groupMode || Boolean(memberId || sourceAllocationId),
  );
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
  return {
    contributor,
    contributorKey: normalizeContributorKey(contributor),
    amount,
    ...(memberId ? { memberId } : {}),
    ...(sourceAllocationId ? { sourceAllocationId } : {}),
  };
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
    if (allocation.memberId || allocation.sourceAllocationId) continue;
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
  const correctionOfEntryId = optionalId(value.correctionOfEntryId);
  if (correctionOfEntryId && (totalAmount > 0 || allocations.some((a) => !a.sourceAllocationId))) {
    throw new ApiError(
      400,
      'Linked corrections require negative allocations and their original allocation IDs.',
      'invalid_correction',
    );
  }
  if (!correctionOfEntryId && allocations.some((a) => a.sourceAllocationId)) {
    throw new ApiError(400, 'A correction source entry is required.', 'invalid_correction');
  }
  return {
    totalAmount,
    allocations,
    note,
    idempotencyKey,
    ...parseOccurrence(value),
    memory: parseMemory(value.memory),
    correctionOfEntryId,
  };
}

function optionalId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,256}$/u.test(value)) {
    throw new ApiError(400, 'Invalid record identifier.', 'invalid_identifier');
  }
  return value;
}

export function parseMemory(value: unknown): MemoryInput | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new ApiError(400, 'Memory must be an object.', 'invalid_memory');
  const allowed = new Set(['title', 'shortNote', 'venue', 'city', 'beer', 'brewery', 'visibility']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ApiError(400, 'Unknown memory field.', 'invalid_memory');
  }
  const field = (key: string, maximum = 80): string | null => {
    const input = value[key];
    if (input === undefined || input === null || input === '') return null;
    if (
      typeof input !== 'string' ||
      [...input.trim()].length > maximum ||
      [...input].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 32 && code !== 9 && code !== 10 && code !== 13;
      })
    ) {
      throw new ApiError(
        400,
        `${key} must be text of ${maximum} characters or fewer.`,
        'invalid_memory',
      );
    }
    return input.trim() || null;
  };
  if (
    value.visibility !== undefined &&
    value.visibility !== 'public' &&
    value.visibility !== 'private'
  ) {
    throw new ApiError(400, 'Memory visibility must be public or private.', 'invalid_memory');
  }
  return {
    title: field('title'),
    shortNote: field('shortNote', 140),
    venue: field('venue'),
    city: field('city'),
    beer: field('beer'),
    brewery: field('brewery'),
    visibility: value.visibility === 'private' ? 'private' : 'public',
  };
}

function parseOccurrence(
  value: Record<string, unknown>,
): Pick<EntryInput, 'occurredAt' | 'occurrenceTimezone' | 'occurrencePrecision'> {
  if (value.occurredAt === undefined || value.occurredAt === null || value.occurredAt === '') {
    if (value.occurrenceTimezone || value.occurrencePrecision)
      throw new ApiError(400, 'An occurrence date is required.', 'invalid_occurrence');
    return { occurredAt: null, occurrenceTimezone: null, occurrencePrecision: null };
  }
  const date = value.occurredAt;
  const zone = value.occurrenceTimezone;
  const precision = value.occurrencePrecision ?? 'minute';
  const match =
    typeof date === 'string'
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?(Z|[+-]\d{2}:\d{2})$/u.exec(
          date,
        )
      : null;
  if (
    typeof date !== 'string' ||
    !match ||
    typeof zone !== 'string' ||
    zone.length > 80 ||
    (precision !== 'day' && precision !== 'minute')
  ) {
    throw new ApiError(
      400,
      'Occurrence needs an ISO date with an explicit offset, IANA timezone, and day or minute precision.',
      'invalid_occurrence',
    );
  }
  const timestamp = Date.parse(date);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((n) => Number(n ?? 0));
  const calendar = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day, hour, minute, second));
  if (
    !Number.isFinite(timestamp) ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() + 1 !== month ||
    calendar.getUTCDate() !== day ||
    (hour ?? 99) > 23 ||
    (minute ?? 99) > 59 ||
    (second ?? 99) > 59 ||
    timestamp < Date.UTC(2000, 0, 1) ||
    timestamp > Date.now() + 300_000
  ) {
    throw new ApiError(
      400,
      'Occurrence must be a valid date from 2000 through now.',
      'invalid_occurrence',
    );
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(timestamp);
    const local = (key: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === key)?.value);
    if (
      local('year') !== year ||
      local('month') !== month ||
      local('day') !== day ||
      local('hour') !== hour ||
      local('minute') !== minute ||
      local('second') !== second ||
      (precision === 'day' && (hour !== 0 || minute !== 0 || second !== 0))
    )
      throw new Error('offset mismatch');
  } catch {
    throw new ApiError(
      400,
      'Occurrence offset must match its timezone; nonexistent local times are not accepted.',
      'invalid_occurrence',
    );
  }
  return {
    occurredAt: new Date(timestamp).toISOString(),
    occurrenceTimezone: zone,
    occurrencePrecision: precision,
  };
}

export function canonicalEntryPayload(input: EntryInput): string {
  return JSON.stringify({
    totalAmount: input.totalAmount,
    note: input.note,
    allocations: input.allocations.map((a) => ({
      contributorKey: a.contributorKey,
      amount: a.amount,
      memberId: a.memberId ?? null,
      sourceAllocationId: a.sourceAllocationId ?? null,
    })),
    occurredAt: input.occurredAt ?? null,
    occurrenceTimezone: input.occurrenceTimezone ?? null,
    occurrencePrecision: input.occurrencePrecision ?? null,
    memory: input.memory ?? null,
    correctionOfEntryId: input.correctionOfEntryId ?? null,
  });
}

export function hasExtendedInput(input: EntryInput): boolean {
  return Boolean(
    input.occurredAt ||
    input.memory ||
    input.correctionOfEntryId ||
    input.allocations.some((a) => a.memberId || a.sourceAllocationId),
  );
}
