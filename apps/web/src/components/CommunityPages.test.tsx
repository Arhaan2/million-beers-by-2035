import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchEntries,
  fetchEntry,
  fetchMember,
  fetchMembers,
  fetchOnThisDate,
  fetchRecap,
  updateMemory,
} from '../lib/api';
import type { BeerEntry, Capabilities, MemberPage } from '../lib/types';
import { CrewPage, EntryDetail, HistoryPage, MemberPageView, RecapsPage } from './CommunityPages';

vi.mock('../lib/api', () => ({
  fetchEntries: vi.fn(),
  fetchEntry: vi.fn(),
  fetchMember: vi.fn(),
  fetchMembers: vi.fn(),
  fetchMilestones: vi.fn(),
  fetchOnThisDate: vi.fn(),
  fetchRecap: vi.fn(),
  updateMemory: vi.fn(),
}));

const member = {
  id: 'sam',
  displayName: 'Sam',
  aliases: [],
  allocationCount: 1,
  participationCount: 1,
  netTotal: 2,
  lastRecordedAt: null,
};
const entry: BeerEntry = {
  id: 'entry-1',
  totalAmount: 2,
  note: 'Friday catch-up',
  createdAt: Date.UTC(2026, 9, 9),
  localDay: '2026-10-09',
  isCorrection: false,
  isGroup: false,
  allocations: [{ id: 'allocation-1', contributor: 'Sam', amount: 2 }],
  memory: { title: 'Friday catch-up' },
  metadataVersion: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('community page feedback', () => {
  it('moves focus from a loading detail title to its asynchronously loaded title', async () => {
    let complete: ((value: Awaited<ReturnType<typeof fetchEntry>>) => void) | undefined;
    vi.mocked(fetchEntry).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(
      <EntryDetail id={entry.id} timezone="America/Los_Angeles" onCorrect={() => undefined} />,
    );
    const loading = screen.getByRole('heading', { name: 'Loading the shared ledger…' });
    expect(loading).toHaveAttribute('id', 'page-title');
    loading.focus();
    await act(async () => {
      complete?.({ entry, corrections: [] });
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Friday catch-up' })).toHaveFocus();
  });

  it('preserves route focus when a member request fails', async () => {
    let fail: ((reason: Error) => void) | undefined;
    vi.mocked(fetchMember).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    render(<MemberPageView id="sam" timezone="America/Los_Angeles" />);
    screen.getByRole('heading', { name: 'Loading the shared ledger…' }).focus();
    await act(async () => {
      fail?.(new Error('Member unavailable.'));
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'This page could not be loaded' })).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Member unavailable.');
  });

  it('keeps focus in an open modal when an underlying detail finishes loading', async () => {
    let complete: ((value: Awaited<ReturnType<typeof fetchEntry>>) => void) | undefined;
    vi.mocked(fetchEntry).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(
      <>
        <EntryDetail id={entry.id} timezone="America/Los_Angeles" onCorrect={() => undefined} />
        <div role="dialog" aria-modal="true" aria-label="Crew access">
          <button>Close login</button>
        </div>
      </>,
    );
    const close = screen.getByRole('button', { name: 'Close login' });
    close.focus();
    await act(async () => {
      complete?.({ entry, corrections: [] });
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Friday catch-up' })).toBeInTheDocument();
    expect(close).toHaveFocus();
  });

  it('retries a directory request in place and preserves the current search input', async () => {
    vi.mocked(fetchMembers)
      .mockRejectedValueOnce(new Error('Connection unavailable.'))
      .mockResolvedValueOnce({ members: [member], nextCursor: null });
    const user = userEvent.setup();
    render(<CrewPage query="q=Sam" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable.');
    await user.type(screen.getByRole('searchbox'), ' Jones');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('link', { name: /Sam 1 positive entries/u }),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('Sam Jones');
    expect(screen.getByRole('status')).toHaveTextContent('1 public member shown.');
    expect(fetchMembers).toHaveBeenNthCalledWith(2, 'q=Sam');
  });

  it('announces pagination and clears a recovered error while retaining current members', async () => {
    let complete: ((page: MemberPage) => void) | undefined;
    vi.mocked(fetchMembers)
      .mockResolvedValueOnce({ members: [member], nextCursor: 'next' })
      .mockRejectedValueOnce(new Error('Offline'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
    const user = userEvent.setup();
    render(<CrewPage query="" />);
    await user.click(await screen.findByRole('button', { name: 'Load more members' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('More members could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Load more members' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading more members…');
    expect(screen.getByRole('heading', { name: 'Sam' })).toBeInTheDocument();
    await act(async () => {
      complete?.({ members: [{ ...member, id: 'alex', displayName: 'Alex' }], nextCursor: null });
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent('2 public members shown.');
  });

  it('explains invalid history ranges before navigation and clears feedback on correction', async () => {
    vi.mocked(fetchEntries).mockResolvedValue({ entries: [], nextCursor: null });
    render(<HistoryPage query="" timezone="America/Los_Angeles" />);
    await screen.findByText('0 matching records shown.');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-10-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose an end date on or after the start date.',
    );
    expect(screen.getByLabelText('Through')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.submit(screen.getByRole('search', { name: 'Shared history' }));
    expect(window.location.hash).toBe('');
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-10-11' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('search', { name: 'Shared history' }));
    expect(window.location.hash).toContain('from=2026-10-10&to=2026-10-11');
  });

  it('rejects impossible recap months with guidance and accepts annual recaps', async () => {
    vi.mocked(fetchRecap).mockResolvedValue({
      period: '2026-10',
      dateBasis: 'recorded',
      netTotal: 0,
      entryCount: 0,
      participantCount: 0,
      entries: [],
      nextCursor: null,
    });
    vi.mocked(fetchOnThisDate).mockResolvedValue({
      dateBasis: 'occurred',
      monthDay: '10-13',
      entries: [],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<RecapsPage query="period=2026-10" timezone="America/Los_Angeles" />);
    const input = screen.getByLabelText('Month (YYYY-MM) or year (YYYY)');
    await user.clear(input);
    await user.type(input, '2026-13');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a year such as 2026');
    expect(input).toBeInvalid();
    await user.click(screen.getByRole('button', { name: 'View recap' }));
    expect(window.location.hash).toBe('');
    await user.clear(input);
    await user.type(input, '2026');
    await user.click(screen.getByRole('button', { name: 'View recap' }));
    expect(window.location.hash).toBe('#/recaps?period=2026');
  });

  it('announces memory save failures and keeps entered details available to retry', async () => {
    vi.mocked(fetchEntry).mockResolvedValue({ entry, corrections: [] });
    vi.mocked(updateMemory).mockRejectedValueOnce(new Error('Your edit could not be saved.'));
    const capabilities: Capabilities = {
      crew: true,
      history: true,
      memories: true,
      occurrence: true,
      linkedCorrections: true,
      metadataEditing: true,
      photos: false,
      strongIdentity: false,
    };
    const user = userEvent.setup();
    render(
      <EntryDetail
        id={entry.id}
        timezone="America/Los_Angeles"
        capabilities={capabilities}
        token="token"
        onCorrect={() => undefined}
      />,
    );
    await user.click(await screen.findByText('Edit public memory details'));
    await user.type(screen.getByLabelText('City'), 'Portland');
    await user.click(screen.getByRole('button', { name: 'Save memory details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your edit could not be saved.');
    expect(screen.getByLabelText('City')).toHaveValue('Portland');
    expect(screen.getByRole('button', { name: 'Save memory details' })).toBeEnabled();
    await user.type(screen.getByLabelText('City'), ', OR');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
