import type { EditorSession } from './types';

const SESSION_KEY = 'million-beers-editor-session';

export function readSession(): EditorSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditorSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    if (parsed.expiresAt <= Date.now() / 1000) {
      clearSession();
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function storeSession(session: EditorSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* Session remains in memory for this tab. */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* In-memory logout still succeeds. */
  }
}
