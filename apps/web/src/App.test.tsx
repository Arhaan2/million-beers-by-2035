import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { UpdateModal } from './components/UpdateModal';
import type { DashboardSummary, EventPayload } from './lib/types';
import { validateUpdate } from './lib/updateValidation';

const summary: DashboardSummary = {
  challenge: {
    target: 1_000_000,
    startAt: '2026-07-24T00:00:00-07:00',
    deadlineAt: '2035-01-01T00:00:00-08:00',
    timezone: 'America/Los_Angeles',
  },
  stats: { total: 7, remaining: 999_993, eventCount: 1, percentComplete: 0.0007, updatedAt: 1 },
  recentEvents: [],
  leaderboard: [],
  dailyTotals: Array.from({ length: 30 }, (_, index) => ({
    localDay: `2026-07-${String(index + 1).padStart(2, '0')}`,
    netTotal: 0,
    eventCount: 0,
  })),
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('loads API data and moves into the logged-in state', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/summary')) return Promise.resolve(jsonResponse(summary));
      if (url.endsWith('/api/login'))
        return Promise.resolve(jsonResponse({ token: 'signed-token', expiresAt: 4_102_444_800 }));
      if (url.endsWith('/api/session'))
        return Promise.resolve(jsonResponse({ valid: true, expiresAt: 4_102_444_800 }));
      return Promise.reject(new Error('unexpected request'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { level: 2, name: '7' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crew login' }));
    await user.type(screen.getByLabelText('Crew code'), '9876');
    await user.click(screen.getByRole('button', { name: 'Unlock editor' }));
    expect(await screen.findByRole('button', { name: 'Add beers' })).toBeInTheDocument();
    expect(sessionStorage.getItem('million-beers-editor-session')).toContain('signed-token');
  });

  it('preserves the last successful dashboard during an API error', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(jsonResponse(summary))
          : Promise.reject(new Error('offline'));
      }),
    );
    render(<App />);
    expect(await screen.findByRole('heading', { level: 2, name: '7' })).toBeInTheDocument();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('Connection degraded')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 2, name: '7' })).toBeInTheDocument();
  });
});

describe('UpdateModal', () => {
  it('validates amount and correction reason', () => {
    expect(validateUpdate(0, false, '')).toMatch(/1 to 250/u);
    expect(validateUpdate(4, true, 'no')).toMatch(/reason/u);
    expect(validateUpdate(4, true, 'duplicate')).toBeNull();
  });

  it('requires correction confirmation and submits a negative amount', async () => {
    const submit = vi.fn<(payload: EventPayload) => Promise<void>>(() => Promise.resolve());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<UpdateModal open onClose={() => undefined} onSubmit={submit} />);
    fireEvent.click(screen.getByLabelText(/Correction mode/u));
    fireEvent.change(screen.getByLabelText('Correction reason'), {
      target: { value: 'Duplicate entry' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Review correction/u }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith('Record a correction of -1 beers?');
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ amount: -1, note: 'Duplicate entry' });
  });
});
