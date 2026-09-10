import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { DRAFT_KEY } from '../lib/drafts';
import type { EntryPayload } from '../lib/types';
import { UpdateModal } from './UpdateModal';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('durable modal recovery', () => {
  it('restores a timed-out exact payload and key after closure and a fresh mount', async () => {
    const submit = vi
      .fn<(payload: EntryPayload) => Promise<void>>()
      .mockRejectedValueOnce(new ApiRequestError('Connection lost after dispatch.', 0, true))
      .mockResolvedValueOnce();
    const user = userEvent.setup();
    const first = render(<UpdateModal open onClose={() => undefined} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText('Custom amount'), { target: { value: '6' } });
    await user.type(screen.getByLabelText('Note (optional)'), 'Friday together');
    await user.click(screen.getByRole('button', { name: 'Record +6 beers' }));
    expect(await screen.findByText('Connection lost after dispatch.')).toBeInTheDocument();
    const original = submit.mock.calls[0]?.[0];
    expect(original).toBeDefined();
    expect(localStorage.getItem(DRAFT_KEY)).toContain('Friday together');
    first.unmount();
    render(<UpdateModal open onClose={() => undefined} onSubmit={submit} />);
    expect(screen.getByRole('heading', { name: 'Resolve saved submission' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Custom amount')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry saved attempt' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]?.[0]).toEqual(original);
  });
  it('preserves an expired-session attempt through reauthentication', async () => {
    const submit = vi
      .fn<(payload: EntryPayload) => Promise<void>>()
      .mockRejectedValueOnce(new ApiRequestError('Session expired.', 401))
      .mockResolvedValueOnce();
    const user = userEvent.setup();
    const first = render(<UpdateModal open onClose={() => undefined} onSubmit={submit} />);
    await user.click(screen.getByRole('button', { name: 'Record +1 beers' }));
    expect(
      await screen.findByText(/Sign in again, then retry this saved attempt/u),
    ).toBeInTheDocument();
    const original = submit.mock.calls[0]?.[0];
    first.unmount();
    render(
      <UpdateModal
        open
        token="different-session-token"
        onClose={() => undefined}
        onSubmit={submit}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Retry saved attempt' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]?.[0]).toEqual(original);
    expect(localStorage.getItem(DRAFT_KEY)).not.toContain('different-session-token');
  });
  it('guards duplicate clicks synchronously before dispatch', async () => {
    let resolve!: () => void;
    const submit = vi.fn<(payload: EntryPayload) => Promise<void>>(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<UpdateModal open onClose={() => undefined} onSubmit={submit} />);
    const button = screen.getByRole('button', { name: 'Record +1 beers' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    resolve();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Record +1 beers' })).toBeEnabled(),
    );
  });
  it('keeps the rejected payload editable after a definitive validation rejection', async () => {
    const submit = vi
      .fn<(payload: EntryPayload) => Promise<void>>()
      .mockRejectedValueOnce(new ApiRequestError('Invalid amount.', 400))
      .mockResolvedValueOnce();
    const user = userEvent.setup();
    render(<UpdateModal open onClose={() => undefined} onSubmit={submit} />);
    await user.click(screen.getByRole('button', { name: 'Record +1 beers' }));
    expect(await screen.findByText('Rejected: Invalid amount.')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom amount')).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Record +1 beers' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      submit.mock.calls[1]?.[0].idempotencyKey,
    );
  });
  it('starts last-group restoration with people only and new reviewed quantities', async () => {
    const submit = vi.fn<(payload: EntryPayload) => Promise<void>>().mockResolvedValue();
    const user = userEvent.setup();
    render(<UpdateModal open onClose={() => undefined} onSubmit={submit} />);
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    await user.type(screen.getByLabelText('Person 1'), 'Mika');
    await user.type(screen.getByLabelText('Person 2'), 'Jo');
    fireEvent.change(screen.getByLabelText('Total beers'), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: 'Split equally' }));
    await user.click(screen.getByRole('button', { name: 'Review group entry' }));
    await user.click(screen.getByRole('button', { name: 'Confirm entry' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    await user.click(screen.getByRole('button', { name: 'Use last group' }));
    expect(screen.getByLabelText('Person 1')).toHaveValue('Mika');
    expect(screen.getByLabelText('Person 2')).toHaveValue('Jo');
    expect(screen.getByLabelText('Beer allocation for participant 1')).toHaveValue(1);
    expect(screen.getByLabelText('Total beers')).toHaveValue(2);
    expect(submit).toHaveBeenCalledOnce();
  });
});
