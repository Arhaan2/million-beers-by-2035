import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  fetchEntries,
  fetchEntry,
  fetchMember,
  fetchMembers,
  fetchOnThisDate,
  fetchRecap,
  updateMemory,
} from '../lib/api';
import type * as Api from '../lib/api';
import type { BeerEntry, Capabilities, MemberPage } from '../lib/types';
import { CrewPage, EntryDetail, HistoryPage, MemberPageView, RecapsPage } from './CommunityPages';
import { MemoryEditor } from './MemoryEditor';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
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

  it('uses accessible month/year controls and available recorded months while preserving query filters', async () => {
    vi.mocked(fetchRecap).mockResolvedValue({
      period: '2026-10',
      dateBasis: 'recorded',
      netTotal: 0,
      entryCount: 0,
      participantCount: 0,
      entries: [],
      nextCursor: null,
      availableMonths: ['2026-10', '2024-02'],
    });
    vi.mocked(fetchOnThisDate).mockResolvedValue({
      dateBasis: 'occurred',
      monthDay: '10-13',
      entries: [],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<RecapsPage query="period=2026-10&city=Portland" timezone="America/Los_Angeles" />);
    await user.click(screen.getByRole('button', { name: '← Previous month' }));
    expect(window.location.hash).toBe('#/recaps?period=2026-09&city=Portland');
    await user.selectOptions(screen.getByLabelText('Recap month'), 'all');
    expect(window.location.hash).toBe('#/recaps?period=2026&city=Portland');
    await user.selectOptions(await screen.findByLabelText('Jump to a recorded month'), '2024-02');
    expect(window.location.hash).toBe('#/recaps?period=2024-02&city=Portland');
  });

  it('provides a recovery route for invalid recap deep links without loading an invalid period', async () => {
    render(<RecapsPage query="period=2026-13" timezone="America/Los_Angeles" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid recap period');
    expect(fetchRecap).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open the current month' })).toBeEnabled();
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
  it('rejects an older detail read after a mutation refresh and updates correction allowances', async () => {
    let oldRead: ((value: Awaited<ReturnType<typeof fetchEntry>>) => void) | undefined;
    vi.mocked(fetchEntry)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldRead = resolve;
          }),
      )
      .mockResolvedValueOnce({
        entry: { ...entry, totalAmount: 4 },
        corrections: [{ ...entry, id: 'correction', isCorrection: true, totalAmount: -1 }],
      });
    const view = render(
      <EntryDetail id={entry.id} timezone="UTC" resourceRevision={0} onCorrect={() => undefined} />,
    );
    view.rerender(
      <EntryDetail id={entry.id} timezone="UTC" resourceRevision={1} onCorrect={() => undefined} />,
    );
    await screen.findByRole('heading', { name: 'Linked corrections' });
    await act(async () => {
      oldRead?.({ entry, corrections: [] });
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Linked corrections' })).toBeInTheDocument();
    expect(screen.getByText('+4')).toBeInTheDocument();
  });

  it('preserves a metadata draft through expiry, then requires a deliberate save after sign-in', async () => {
    vi.mocked(fetchEntry).mockResolvedValue({ entry, corrections: [] });
    vi.mocked(updateMemory)
      .mockRejectedValueOnce(new ApiRequestError('Session expired.', 401))
      .mockResolvedValueOnce({
        entry: {
          ...entry,
          metadataVersion: 1,
          memory: { title: 'Friday catch-up', city: 'Portland' },
        },
      });
    const onLogin = vi.fn();
    const capabilities = { metadataEditing: true } as Capabilities;
    const props = {
      id: entry.id,
      timezone: 'UTC',
      capabilities,
      onCorrect: () => undefined,
      onLogin,
    };
    const view = render(<EntryDetail {...props} token="old" />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Edit public memory details'));
    await user.type(screen.getByLabelText('City'), 'Portland');
    await user.click(screen.getByRole('button', { name: 'Save memory details' }));
    expect(onLogin).toHaveBeenCalledOnce();
    view.rerender(<EntryDetail {...props} />);
    expect(screen.getByLabelText('City')).toHaveValue('Portland');
    view.rerender(<EntryDetail {...props} token="new" />);
    expect(updateMemory).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Save memory details' }));
    expect(updateMemory).toHaveBeenLastCalledWith(
      entry.id,
      expect.objectContaining({ city: 'Portland' }),
      0,
      'new',
    );
  });

  it('preserves both versions on conflict and only rebases a draft after an explicit review choice', async () => {
    vi.mocked(fetchEntry)
      .mockResolvedValueOnce({ entry, corrections: [] })
      .mockResolvedValue({
        entry: { ...entry, metadataVersion: 2, memory: { city: 'Seattle' } },
        corrections: [],
      });
    vi.mocked(updateMemory)
      .mockRejectedValueOnce(new ApiRequestError('Conflict.', 409))
      .mockResolvedValueOnce({
        entry: { ...entry, metadataVersion: 3, memory: { city: 'Portland' } },
      });
    const user = userEvent.setup();
    render(
      <EntryDetail
        id={entry.id}
        timezone="UTC"
        capabilities={{ metadataEditing: true } as Capabilities}
        token="token"
        onCorrect={() => undefined}
      />,
    );
    await user.click(await screen.findByText('Edit public memory details'));
    await user.type(screen.getByLabelText('City'), 'Portland');
    await user.click(screen.getByRole('button', { name: 'Save memory details' }));
    expect(
      within(await screen.findByRole('region', { name: 'Latest saved memory' })).getByText(
        'Seattle',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toHaveValue('Portland');
    expect(screen.getByRole('button', { name: 'Save memory details' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Keep my draft for review' }));
    expect(updateMemory).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Save memory details' }));
    expect(updateMemory).toHaveBeenLastCalledWith(
      entry.id,
      expect.objectContaining({ city: 'Portland' }),
      2,
      'token',
    );
  });

  it('reconciles an uncertain memory save with the server without submitting it twice', async () => {
    vi.mocked(fetchEntry)
      .mockResolvedValueOnce({ entry, corrections: [] })
      .mockResolvedValue({
        entry: {
          ...entry,
          metadataVersion: 1,
          memory: { title: 'Friday catch-up', city: 'Portland' },
        },
        corrections: [],
      });
    vi.mocked(updateMemory).mockRejectedValueOnce(new ApiRequestError('Timeout.', 0, true));
    const user = userEvent.setup();
    render(
      <EntryDetail
        id={entry.id}
        timezone="UTC"
        capabilities={{ metadataEditing: true } as Capabilities}
        token="token"
        onCorrect={() => undefined}
      />,
    );
    await user.click(await screen.findByText('Edit public memory details'));
    await user.type(screen.getByLabelText('City'), 'Portland');
    await user.click(screen.getByRole('button', { name: 'Save memory details' }));
    expect(
      await screen.findByText('The latest saved details match your draft. Save confirmed.'),
    ).toBeInTheDocument();
    expect(updateMemory).toHaveBeenCalledOnce();
  });
  it('refreshes every loaded history page after a mutation while preserving typed filters', async () => {
    const second = { ...entry, id: 'entry-2', note: 'Second entry' };
    vi.mocked(fetchEntries)
      .mockResolvedValueOnce({ entries: [entry], nextCursor: 'next' })
      .mockResolvedValueOnce({ entries: [second], nextCursor: null })
      .mockResolvedValueOnce({ entries: [{ ...entry, totalAmount: 3 }], nextCursor: 'next-new' })
      .mockResolvedValueOnce({ entries: [second], nextCursor: null });
    const user = userEvent.setup();
    const view = render(<HistoryPage query="city=Portland" timezone="UTC" resourceRevision={0} />);
    await user.click(await screen.findByRole('button', { name: 'Load more records' }));
    await screen.findByText('2 matching records shown.');
    await user.type(screen.getByLabelText('Venue'), 'Unsaved filter');
    view.rerender(<HistoryPage query="city=Portland" timezone="UTC" resourceRevision={1} />);
    await screen.findByText('+3');
    expect(screen.getByText('2 matching records shown.')).toBeInTheDocument();
    expect(screen.getByLabelText('Venue')).toHaveValue('Unsaved filter');
    expect(fetchEntries).toHaveBeenLastCalledWith('city=Portland&cursor=next-new');
  });

  it('refreshes recap metrics in place after a new record', async () => {
    const recap = {
      period: '2026-10',
      dateBasis: 'recorded' as const,
      netTotal: 2,
      entryCount: 1,
      participantCount: 1,
      entries: [entry],
      nextCursor: null,
      availableMonths: ['2026-10'],
    };
    vi.mocked(fetchRecap)
      .mockResolvedValueOnce(recap)
      .mockResolvedValueOnce({ ...recap, netTotal: 4 });
    vi.mocked(fetchOnThisDate).mockResolvedValue({
      dateBasis: 'occurred',
      monthDay: '10-13',
      entries: [],
      nextCursor: null,
    });
    const view = render(
      <RecapsPage query="period=2026-10&city=Portland" timezone="UTC" resourceRevision={0} />,
    );
    await screen.findByText('2');
    view.rerender(
      <RecapsPage query="period=2026-10&city=Portland" timezone="UTC" resourceRevision={1} />,
    );
    await screen.findByText('4');
    expect(screen.getByLabelText('Recap month')).toHaveValue('10');
    expect(fetchRecap).toHaveBeenLastCalledWith('2026-10', 'period=2026-10&city=Portland');
  });
  it('clears a hidden member after a definitive refreshed 404', async () => {
    vi.mocked(fetchMember)
      .mockResolvedValueOnce({ member, history: { entries: [entry], nextCursor: null } })
      .mockRejectedValueOnce(new ApiRequestError('Member not found.', 404));
    const view = render(<MemberPageView id="sam" timezone="UTC" resourceRevision={0} />);
    await screen.findByRole('heading', { name: 'Sam' });
    view.rerender(<MemberPageView id="sam" timezone="UTC" resourceRevision={1} />);
    await screen.findByText('Member not found.');
    expect(screen.queryByRole('heading', { name: 'Sam' })).not.toBeInTheDocument();
    expect(screen.queryByText('Friday catch-up')).not.toBeInTheDocument();
  });

  it('removes saved metadata on same-version privacy redaction while retaining only typed changes', async () => {
    const original = {
      ...entry,
      memory: { title: 'Old public title', venue: 'Old venue', city: 'Old city' },
    };
    vi.mocked(fetchEntry)
      .mockResolvedValueOnce({ entry: original, corrections: [] })
      .mockResolvedValueOnce({ entry: { ...original, memory: null }, corrections: [] });
    const props = {
      id: entry.id,
      timezone: 'UTC',
      token: 'token',
      capabilities: { metadataEditing: true } as Capabilities,
      onCorrect: () => undefined,
    };
    const view = render(<EntryDetail {...props} resourceRevision={0} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Edit public memory details'));
    await user.clear(screen.getByLabelText('City'));
    await user.type(screen.getByLabelText('City'), 'My unsaved city');
    view.rerender(<EntryDetail {...props} resourceRevision={1} />);
    await screen.findByText(/Previously saved text was removed/u);
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Venue')).toHaveValue('');
    expect(screen.getByLabelText('City')).toHaveValue('My unsaved city');
    expect(screen.queryByText('Old public title')).not.toBeInTheDocument();
  });

  it('preserves only authored metadata draft fields while a changed-revision refresh fails', async () => {
    vi.mocked(fetchEntry)
      .mockResolvedValueOnce({ entry, corrections: [] })
      .mockRejectedValueOnce(new Error('Offline now.'));
    const props = {
      id: entry.id,
      timezone: 'UTC',
      token: 'token',
      capabilities: { metadataEditing: true } as Capabilities,
      onCorrect: () => undefined,
    };
    const view = render(<EntryDetail {...props} resourceRevision={0} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Edit public memory details'));
    await user.type(screen.getByLabelText('City'), 'Unsaved city');
    view.rerender(<EntryDetail {...props} resourceRevision={1} />);
    await screen.findByText('Offline now.');
    expect(screen.getByLabelText('City')).toHaveValue('Unsaved city');
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save memory details' })).toBeDisabled();
  });

  it('keeps only freshly projected pages when a later refresh page fails', async () => {
    vi.mocked(fetchEntries)
      .mockResolvedValueOnce({ entries: [entry], nextCursor: 'next' })
      .mockResolvedValueOnce({
        entries: [{ ...entry, id: 'second', memory: { title: 'Old second private detail' } }],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        entries: [{ ...entry, note: null, memory: null }],
        nextCursor: 'new-next',
      })
      .mockRejectedValueOnce(new Error('Second refresh page failed.'));
    const user = userEvent.setup();
    const view = render(<HistoryPage query="" timezone="UTC" resourceRevision={0} />);
    await user.click(await screen.findByRole('button', { name: 'Load more records' }));
    await screen.findByText('Old second private detail');
    view.rerender(<HistoryPage query="" timezone="UTC" resourceRevision={1} />);
    await screen.findByText('Second refresh page failed.');
    expect(screen.queryByText('Old second private detail')).not.toBeInTheDocument();
    expect(screen.queryByText('Friday catch-up')).not.toBeInTheDocument();
  });
  it('clears a saved conflict preview when a later projection is redacted', async () => {
    vi.mocked(updateMemory).mockRejectedValueOnce(new ApiRequestError('Conflict.', 409));
    vi.mocked(fetchEntry).mockResolvedValue({
      entry: { ...entry, metadataVersion: 2, memory: { title: 'Saved conflict title' } },
      corrections: [],
    });
    const props = { token: 'token', onSaved: vi.fn(), onLogin: vi.fn(), initiallyOpen: true };
    const view = render(<MemoryEditor {...props} entry={entry} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('City'), 'Draft city');
    await user.click(screen.getByRole('button', { name: 'Save memory details' }));
    await screen.findByText('Saved conflict title');
    view.rerender(
      <MemoryEditor {...props} entry={{ ...entry, memory: null }} resourceRevision={1} />,
    );
    expect(screen.queryByText('Saved conflict title')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('City')).toHaveValue('Draft city');
    expect(screen.getByRole('button', { name: 'Check latest saved details' })).toBeInTheDocument();
  });

  it('ignores a late save response after a newer privacy projection', async () => {
    let finish: ((value: { entry: BeerEntry }) => void) | undefined;
    vi.mocked(updateMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onSaved = vi.fn();
    const props = { token: 'token', onSaved, onLogin: vi.fn(), initiallyOpen: true };
    const view = render(<MemoryEditor {...props} entry={entry} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('City'), 'Draft city');
    await user.click(screen.getByRole('button', { name: 'Save memory details' }));
    view.rerender(
      <MemoryEditor {...props} entry={{ ...entry, memory: null }} resourceRevision={1} />,
    );
    await act(async () => {
      finish?.({
        entry: {
          ...entry,
          metadataVersion: 1,
          memory: { title: 'Late saved title', city: 'Draft city' },
        },
      });
      await Promise.resolve();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('City')).toHaveValue('Draft city');
  });
  it('does not retain a saved field as a draft after its edit is reverted', async () => {
    const props = { token: 'token', onSaved: vi.fn(), onLogin: vi.fn(), initiallyOpen: true };
    const view = render(<MemoryEditor {...props} entry={entry} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'x');
    await user.keyboard('{Backspace}');
    expect(screen.getByLabelText('Title')).toHaveValue('Friday catch-up');
    view.rerender(<MemoryEditor {...props} entry={{ ...entry, memory: null }} />);
    expect(screen.getByLabelText('Title')).toHaveValue('');
  });
  it.each([409, 0])(
    'applies a same-version privacy projection first discovered during reconciliation (%i)',
    async (status) => {
      const original = {
        ...entry,
        memory: { title: 'Original public title', venue: 'Old public place' },
      };
      const correction = {
        ...entry,
        id: 'correction',
        isCorrection: true,
        note: 'Original correction note',
        memory: null,
      };
      const hidden = {
        ...original,
        memory: null,
        note: null,
        allocations: [
          { id: 'allocation-1', memberId: null, contributor: 'Private member', amount: 2 },
        ],
      };
      vi.mocked(fetchEntry)
        .mockResolvedValueOnce({ entry: original, corrections: [correction] })
        .mockResolvedValue({
          entry: hidden,
          corrections: [{ ...correction, note: null, allocations: hidden.allocations }],
        });
      vi.mocked(updateMemory).mockRejectedValueOnce(
        new ApiRequestError('Save not confirmed.', status, status === 0),
      );
      const props = {
        id: entry.id,
        timezone: 'UTC',
        token: 'token',
        capabilities: { metadataEditing: true } as Capabilities,
        onCorrect: () => undefined,
      };
      const view = render(<EntryDetail {...props} resourceRevision={0} />);
      const user = userEvent.setup();
      await user.click(await screen.findByText('Edit public memory details'));
      await user.type(screen.getByLabelText('City'), 'Draft city');
      await user.click(screen.getByRole('button', { name: 'Save memory details' }));
      await screen.findByRole('region', { name: 'Latest saved memory' });
      expect(screen.getByLabelText('Title')).toHaveValue('');
      expect(screen.getByLabelText('Venue')).toHaveValue('');
      expect(screen.getByLabelText('City')).toHaveValue('Draft city');
      expect(screen.queryByText('Original public title')).not.toBeInTheDocument();
      expect(screen.queryByText('Original correction note')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Use latest saved details' }));
      view.rerender(<EntryDetail {...props} resourceRevision={1} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByLabelText('Title')).toHaveValue('');
      expect(screen.getByLabelText('City')).toHaveValue('');
      expect(screen.queryByText('Original public title')).not.toBeInTheDocument();
    },
  );
});
