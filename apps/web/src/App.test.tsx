import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { UpdateModal } from './components/UpdateModal';
import type { DashboardSummary, EntryPayload } from './lib/types';
import { validateUpdate } from './lib/updateValidation';

const summary: DashboardSummary = {
  challenge: {
    target: 1_000_000,
    startAt: '2026-07-24T00:00:00-07:00',
    deadlineAt: '2035-01-01T00:00:00-08:00',
    timezone: 'America/Los_Angeles',
  },
  stats: {
    total: 7,
    remaining: 999_993,
    eventCount: 1,
    entryCount: 1,
    allocationCount: 1,
    crewSize: 12,
    percentComplete: 0.0007,
    updatedAt: 1,
  },
  recentEntries: [],
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

function renderDashboard(crewSize = summary.stats.crewSize): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        jsonResponse(
          (typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
          ).endsWith('/api/milestones')
            ? {
                dateBasis: 'recorded-day-close',
                limitation: 'Daily closing totals',
                milestones: [],
              }
            : {
                ...summary,
                stats: { ...summary.stats, crewSize },
              },
        ),
      ),
    ),
  );
  render(<App />);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('App', () => {
  it('skips to content without leaving the current page', async () => {
    window.history.replaceState(null, '', '/#/about');
    renderDashboard();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(window.location.hash).toBe('#/about');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(
      screen.getByRole('heading', { name: 'An impossible number. Real time together.' }),
    ).toBeInTheDocument();
  });

  it('restores the recording trigger after the login and editor dialog flow', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/api/login'))
          return Promise.resolve(jsonResponse({ token: 'signed-token', expiresAt: 4_102_444_800 }));
        if (url.endsWith('/api/session')) return Promise.resolve(jsonResponse({ valid: true }));
        if (url.endsWith('/api/milestones'))
          return Promise.resolve(jsonResponse({ milestones: [] }));
        return Promise.resolve(jsonResponse(summary));
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    const opener = await screen.findByRole('button', { name: 'Record entry' });
    await user.click(opener);
    expect(screen.getByRole('main').closest('.app-content')).toHaveAttribute('inert');
    await user.type(screen.getByLabelText('Crew code'), 'test-code');
    await user.click(screen.getByRole('button', { name: 'Unlock editor' }));
    await screen.findByRole('dialog', { name: 'Record entry' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.getByRole('main').closest('.app-content')).not.toHaveAttribute('inert');
  });

  it('shows one canonical hero total and keeps useful statistics in an expandable area', async () => {
    renderDashboard();
    expect(await screen.findByRole('heading', { level: 2, name: '7' })).toBeInTheDocument();
    expect(screen.queryByText('Beers recorded')).not.toBeInTheDocument();
    const statistics = screen.getByText('Explore the numbers').closest('details');
    expect(statistics).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Explore the numbers'));
    expect(screen.getByText('Named contributor records')).toBeInTheDocument();
    expect(screen.getByText('Raw allocation count')).toBeInTheDocument();
    expect(screen.getByText('Extrapolated finish')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  it.each([0, 1, 2])(
    'uses an honest named-record label for legacy crew size %i',
    async (crewSize) => {
      renderDashboard(crewSize);
      expect(await screen.findByText(`${crewSize} named contributor records`)).toBeInTheDocument();
    },
  );

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
    expect(await screen.findByRole('button', { name: 'Log out' })).toBeInTheDocument();
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
    const submit = vi.fn<(payload: EntryPayload) => Promise<void>>(() => Promise.resolve());
    render(<UpdateModal open onClose={() => undefined} onSubmit={submit} />);
    fireEvent.click(screen.getByLabelText(/Correction mode/u));
    fireEvent.change(screen.getByLabelText('Correction reason'), {
      target: { value: 'Duplicate entry' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Review correction/u }));
    expect(screen.getByRole('heading', { name: 'Review correction' })).toHaveFocus();
    expect(screen.getByText('Record a correction of 1 beer?')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm correction' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      totalAmount: -1,
      allocations: [{ amount: -1 }],
      note: 'Duplicate entry',
    });
  });
});
