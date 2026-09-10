import type {
  DashboardSummary,
  EditorSession,
  EntryPayload,
  EventPayload,
  EntryResult,
  MemberPage,
  CrewMember,
  EntryPage,
  BeerEntry,
  Recap,
  MemoryMetadata,
} from './types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/u, '');

export class ApiRequestError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable = false) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.retryable = retryable;
  }
}

function endpoint(path: string): string {
  if (!API_BASE_URL) throw new ApiRequestError('The API URL is not configured.', 0);
  return `${API_BASE_URL}${path}`;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint(path), { ...init, signal: controller.signal });
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (!response.ok) {
      const message =
        typeof body?.error === 'string' ? body.error : 'The request could not be completed.';
      throw new ApiRequestError(message, response.status, response.status >= 500);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiRequestError(
        'Submission status unknown: the request timed out. Retry the saved attempt to check it.',
        0,
        true,
      );
    }
    throw new ApiRequestError('Unable to reach the project API.', 0, true);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function fetchSummary(): Promise<DashboardSummary> {
  return requestJson<DashboardSummary>('/api/summary', { cache: 'no-store' });
}

export function login(code: string): Promise<EditorSession> {
  return requestJson<EditorSession>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export function validateSession(token: string): Promise<{ valid: true; expiresAt: number }> {
  return requestJson('/api/session', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function submitEvent(
  payload: EventPayload,
  token: string,
): Promise<{ total: number; idempotent: boolean }> {
  return requestJson('/api/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function submitEntry(payload: EntryPayload, token: string): Promise<EntryResult> {
  return requestJson('/api/entries', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function fetchMembers(query = ''): Promise<MemberPage> {
  return requestJson(`/api/members${query ? `?${query}` : ''}`, { cache: 'no-store' });
}
export function createMember(displayName: string, token: string): Promise<{ member: CrewMember }> {
  return requestJson('/api/members', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
}
export function fetchMember(id: string): Promise<{ member: CrewMember; history: EntryPage }> {
  return requestJson(`/api/members/${encodeURIComponent(id)}`, { cache: 'no-store' });
}
export function fetchEntries(query = ''): Promise<EntryPage> {
  return requestJson(`/api/entries${query ? `?${query}` : ''}`, { cache: 'no-store' });
}
export function fetchEntry(id: string): Promise<{ entry: BeerEntry; corrections: BeerEntry[] }> {
  return requestJson(`/api/entries/${encodeURIComponent(id)}`, { cache: 'no-store' });
}
export function fetchRecap(period: string): Promise<Recap> {
  return requestJson(`/api/recaps?period=${encodeURIComponent(period)}`, { cache: 'no-store' });
}
export function updateMemory(
  id: string,
  memory: MemoryMetadata,
  expectedVersion: number,
  token: string,
): Promise<{ entry: BeerEntry }> {
  return requestJson(`/api/entries/${encodeURIComponent(id)}/memory`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ memory, expectedVersion }),
  });
}

export function fetchOnThisDate(
  query = '',
): Promise<EntryPage & { dateBasis: 'occurred'; monthDay: string }> {
  return requestJson(`/api/memories/on-this-date${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
}

export function fetchMilestones(): Promise<{
  dateBasis: 'recorded-day-close';
  limitation: string;
  milestones: Array<{ amount: number; recordedDay: string; closingTotal: number }>;
}> {
  return requestJson('/api/milestones', { cache: 'no-store' });
}
