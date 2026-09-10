import type { EntryPayload, MemoryMetadata } from './types';

export const DRAFT_KEY = 'million-beers:v1:entry-draft';
const GROUP_KEY = 'million-beers:v1:participant-groups';
const EXPIRY = 7 * 24 * 60 * 60 * 1000;
export interface ParticipantDraft {
  id: string;
  contributor: string;
  amount: number;
  memberId?: string | undefined;
  sourceAllocationId?: string | undefined;
  maximum?: number;
}
export interface FormDraft {
  mode: 'single' | 'group';
  amount: number;
  groupTotal: number;
  participants: ParticipantDraft[];
  contributor: string;
  memberId?: string | undefined;
  note: string;
  correction: boolean;
  correctionOfEntryId?: string | undefined;
  memory: MemoryMetadata;
  date: string;
  time: string;
  timezone: string;
}
export interface DraftRecord {
  version: 1;
  updatedAt: number;
  expiresAt: number;
  form: FormDraft;
  attempt?: { payload: EntryPayload; state: 'submitting' | 'unknown' | 'auth' };
}
let memoryFallback: DraftRecord | null = null;
const defaultStorageStatus =
  'Drafts stay on this device for 7 days. Unresolved submissions are kept until resolved. No crew code or editor token is saved with a draft.';
let storageStatus = defaultStorageStatus;
function stores(): Storage[] {
  const values: Storage[] = [];
  try {
    values.push(localStorage);
  } catch {
    /* browser may deny access entirely */
  }
  try {
    values.push(sessionStorage);
  } catch {
    /* in-memory editing remains available */
  }
  return values;
}
export function getDraftStatus(): string {
  return storageStatus;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}
function memory(value: unknown): boolean {
  return (
    record(value) &&
    Object.values(value).every((item) => item === undefined || typeof item === 'string')
  );
}
function personRecord(value: unknown): boolean {
  return record(value) && typeof value.contributor === 'string' && optionalText(value.memberId);
}
function validDraft(value: unknown): value is DraftRecord {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Number.isFinite(value.updatedAt) ||
    !Number.isFinite(value.expiresAt) ||
    !record(value.form)
  )
    return false;
  const form = value.form;
  if (
    (form.mode !== 'single' && form.mode !== 'group') ||
    !Number.isFinite(form.amount) ||
    !Number.isFinite(form.groupTotal) ||
    !Array.isArray(form.participants) ||
    form.participants.length > 25 ||
    !form.participants.every(
      (item: unknown) =>
        personRecord(item) &&
        record(item) &&
        typeof item.id === 'string' &&
        Number.isFinite(item.amount) &&
        optionalText(item.sourceAllocationId) &&
        (item.maximum === undefined || Number.isFinite(item.maximum)),
    )
  )
    return false;
  if (
    !['contributor', 'note', 'date', 'time', 'timezone'].every(
      (key) => typeof form[key] === 'string',
    ) ||
    typeof form.correction !== 'boolean' ||
    !optionalText(form.memberId) ||
    !optionalText(form.correctionOfEntryId) ||
    !memory(form.memory)
  )
    return false;
  if (value.attempt !== undefined) {
    if (
      !record(value.attempt) ||
      !['submitting', 'unknown', 'auth'].includes(String(value.attempt.state)) ||
      !record(value.attempt.payload)
    )
      return false;
    const payload = value.attempt.payload;
    if (
      typeof payload.idempotencyKey !== 'string' ||
      !payload.idempotencyKey ||
      !Number.isFinite(payload.totalAmount) ||
      typeof payload.note !== 'string' ||
      !Array.isArray(payload.allocations) ||
      !payload.allocations.length ||
      payload.allocations.length > 25 ||
      !payload.allocations.every(
        (item: unknown) =>
          personRecord(item) &&
          record(item) &&
          Number.isFinite(item.amount) &&
          optionalText(item.sourceAllocationId),
      )
    )
      return false;
    if (payload.memory !== undefined && !memory(payload.memory)) return false;
    if (
      !['occurredAt', 'occurrenceTimezone', 'occurrencePrecision', 'correctionOfEntryId'].every(
        (key) => optionalText(payload[key]),
      )
    )
      return false;
  }
  return true;
}
export function isDraftShared(key: string): boolean {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    return validDraft(value) && value.attempt?.payload.idempotencyKey === key;
  } catch {
    return false;
  }
}
export function readDraft(): DraftRecord | null {
  const candidates: DraftRecord[] = [];
  for (const storage of stores()) {
    try {
      const raw = storage.getItem(DRAFT_KEY);
      if (!raw) continue;
      const draft: unknown = JSON.parse(raw);
      if (!validDraft(draft)) continue;
      if (draft.expiresAt < Date.now() && !draft.attempt) {
        continue;
      }
      candidates.push(draft);
    } catch {
      /* corrupted/unavailable storage cannot crash the form */
    }
  }
  if (memoryFallback) candidates.push(memoryFallback);
  // Never let a newer editable draft replace an unresolved submission.
  return (
    candidates.sort(
      (a, b) =>
        Number(Boolean(b.attempt)) - Number(Boolean(a.attempt)) || b.updatedAt - a.updatedAt,
    )[0] ?? null
  );
}
export function writeDraft(draft: DraftRecord): boolean {
  memoryFallback = draft;
  const available = stores();
  for (let index = 0; index < available.length; index += 1) {
    try {
      available[index]?.setItem(DRAFT_KEY, JSON.stringify(draft));
      memoryFallback = null;
      if (index === 0) storageStatus = defaultStorageStatus;
      else
        storageStatus =
          'Device storage is unavailable. This draft is saved only for this tab and survives reloads here. Keep this tab open until an uncertain submission is resolved.';
      return true;
    } catch {
      /* try tab storage before blocking a mutation */
    }
  }
  storageStatus =
    'Browser storage is unavailable. Editing still works, but recording is paused because a retry key cannot be preserved across reloads. Enable browser storage and try again, or download your draft.';
  return false;
}
// Call under the project lock. A confirmed completion may clear only its own key;
// a user discarding editable fields may never erase an unresolved submission.
export function clearDraft(confirmedKey?: string): boolean {
  if (memoryFallback?.attempt && memoryFallback.attempt.payload.idempotencyKey !== confirmedKey)
    return false;
  for (const storage of stores()) {
    try {
      const raw: unknown = JSON.parse(storage.getItem(DRAFT_KEY) ?? 'null');
      if (validDraft(raw) && raw.attempt && raw.attempt.payload.idempotencyKey !== confirmedKey)
        return false;
    } catch {
      /* A malformed editable record is safe to discard. */
    }
  }
  memoryFallback = null;
  let success = false;
  for (const storage of stores()) {
    try {
      storage.removeItem(DRAFT_KEY);
      success = true;
    } catch {
      /* retain notice */
    }
  }
  return success;
}
export function makeDraft(form: FormDraft, attempt?: DraftRecord['attempt']): DraftRecord {
  return {
    version: 1,
    updatedAt: Date.now(),
    expiresAt: Date.now() + EXPIRY,
    form,
    ...(attempt ? { attempt } : {}),
  };
}
export interface SavedGroup {
  name: string;
  people: Array<Pick<ParticipantDraft, 'contributor' | 'memberId'>>;
}
export function readGroups(): SavedGroup[] {
  try {
    const groups = JSON.parse(localStorage.getItem(GROUP_KEY) ?? '[]') as SavedGroup[];
    return Array.isArray(groups)
      ? groups
          .filter(
            (group) =>
              record(group) &&
              typeof group.name === 'string' &&
              Array.isArray(group.people) &&
              group.people.length >= 2 &&
              group.people.length <= 25 &&
              group.people.every(personRecord),
          )
          .slice(0, 10)
      : [];
  } catch {
    return [];
  }
}
export function saveGroup(group: SavedGroup): boolean {
  try {
    localStorage.setItem(
      GROUP_KEY,
      JSON.stringify(
        [group, ...readGroups().filter((item) => item.name !== group.name)].slice(0, 10),
      ),
    );
    return true;
  } catch {
    return false;
  }
}
export async function withDraftLock<T>(
  task: () => Promise<T>,
  exactSavedRetry = false,
): Promise<T | undefined> {
  if (navigator.locks)
    return navigator.locks.request(
      'million-beers-entry-submit',
      { ifAvailable: true },
      async (lock) => (lock ? task() : undefined),
    );
  // Only an already frozen key/payload can safely be retried without cross-tab coordination.
  if (!exactSavedRetry)
    throw new Error(
      'This browser cannot coordinate new submissions across tabs. Your draft has not been sent. Use a browser with Web Locks support; editing and draft download remain available.',
    );
  return task();
}
export function downloadDraft(draft: DraftRecord): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'million-beers-local-draft.json';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const RECENT_KEY = 'million-beers:v1:recent-participants';
export function readRecentParticipants(): SavedGroup['people'] {
  try {
    const values = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as SavedGroup['people'];
    return Array.isArray(values)
      ? values
          .filter(
            (item) =>
              record(item) &&
              typeof item.contributor === 'string' &&
              typeof item.memberId === 'string',
          )
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}
export function saveRecentParticipants(people: SavedGroup['people']): void {
  try {
    const unique = new Map<string, SavedGroup['people'][number]>();
    for (const member of [...people, ...readRecentParticipants()])
      if (member.memberId && !unique.has(member.memberId)) unique.set(member.memberId, member);
    localStorage.setItem(RECENT_KEY, JSON.stringify([...unique.values()].slice(0, 8)));
  } catch {
    /* Optional shortcuts never change entry success. */
  }
}

// Every editable write/discard joins the very same lock as submission. Re-read
// inside the lock: a storage event can arrive after another tab has dispatched.
export async function persistEditableDraft(
  form: FormDraft,
  stillCurrent: () => boolean = () => true,
): Promise<boolean> {
  return (
    (await withDraftLock(
      () => Promise.resolve(stillCurrent() && !readDraft()?.attempt && writeDraft(makeDraft(form))),
      true,
    )) ?? false
  );
}
export async function discardEditableDraft(): Promise<boolean> {
  return (await withDraftLock(() => Promise.resolve(clearDraft()), true)) ?? false;
}
