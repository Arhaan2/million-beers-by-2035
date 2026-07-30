import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../lib/api';
import type { EntryPayload } from '../lib/types';
import { UpdateModal } from './UpdateModal';

function setup(submit = vi.fn<(payload: EntryPayload) => Promise<void>>(() => Promise.resolve())) {
  render(<UpdateModal open onClose={() => undefined} onSubmit={submit} />);
  return { submit, user: userEvent.setup() };
}

async function enterGroupNames(
  user: ReturnType<typeof userEvent.setup>,
  names = ['Arhaan', 'Sam'],
) {
  await user.type(screen.getByLabelText('Person 1'), names[0] ?? 'Arhaan');
  await user.type(screen.getByLabelText('Person 2'), names[1] ?? 'Sam');
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('UpdateModal group mode', () => {
  it('keeps single-person mode as the default', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Single person' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Custom amount')).toBeInTheDocument();
    expect(screen.queryByLabelText('Total beers')).not.toBeInTheDocument();
  });

  it('starts group mode with two rows and supports adding and removing a participant', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    expect(screen.getByLabelText('Person 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Person 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove participant/u })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    expect(screen.getByLabelText('Person 3')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Remove participant 3' }));
    expect(screen.queryByLabelText('Person 3')).not.toBeInTheDocument();
  });

  it('equal-splits 10 across 3 as 4, 3, 3 and allows manual edits afterward', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    fireEvent.change(screen.getByLabelText('Total beers'), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    await user.click(screen.getByRole('button', { name: 'Split equally' }));
    expect(screen.getByLabelText('Beer allocation for participant 1')).toHaveValue(4);
    expect(screen.getByLabelText('Beer allocation for participant 2')).toHaveValue(3);
    expect(screen.getByLabelText('Beer allocation for participant 3')).toHaveValue(3);
    fireEvent.change(screen.getByLabelText('Beer allocation for participant 1'), {
      target: { value: '5' },
    });
    expect(screen.getByText('Allocated 1 beer too many')).toBeInTheDocument();
  });

  it('blocks equal splitting when the total is below the participant count', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    expect(screen.getByRole('button', { name: 'Split equally' })).toBeDisabled();
    expect(screen.getByText(/total must be at least the number of people/u)).toBeInTheDocument();
  });

  it('announces remaining allocation and disables review until the split is exact', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    fireEvent.change(screen.getByLabelText('Total beers'), { target: { value: '5' } });
    expect(screen.getByText('3 beers left to allocate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review group entry' })).toBeDisabled();
    await enterGroupNames(user);
    fireEvent.change(screen.getByLabelText('Beer allocation for participant 1'), {
      target: { value: '3' },
    });
    expect(screen.getByText('1 beer left to allocate')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Beer allocation for participant 2'), {
      target: { value: '2' },
    });
    expect(screen.getByText('5 of 5 allocated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review group entry' })).toBeEnabled();
  });

  it('rejects duplicate normalized participant names', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    await user.type(screen.getByLabelText('Person 1'), 'Arhaan');
    await user.type(screen.getByLabelText('Person 2'), '  arhaan  ');
    expect(screen.getByText('Each participant name must be unique.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review group entry' })).toBeDisabled();
  });

  it('shows a compact review and returns to editing without losing values', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    await enterGroupNames(user);
    await user.type(screen.getByLabelText('Shared note (optional)'), 'Friday night hangout');
    await user.click(screen.getByRole('button', { name: 'Review group entry' }));
    expect(screen.getByText('Record 2 beers across 2 people?')).toBeInTheDocument();
    expect(screen.getByText('Friday night hangout')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to edit' }));
    expect(screen.getByLabelText('Person 1')).toHaveValue('Arhaan');
    expect(screen.getByLabelText('Shared note (optional)')).toHaveValue('Friday night hangout');
  });

  it('submits correction values with negative signs only after confirmation', async () => {
    const { submit, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    await enterGroupNames(user);
    await user.click(screen.getByLabelText(/Correction mode/u));
    await user.type(screen.getByLabelText('Correction reason'), 'Duplicate group entry');
    await user.click(screen.getByRole('button', { name: 'Review group correction' }));
    expect(screen.getByText('Record a correction of 2 beers across 2 people?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm correction' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      totalAmount: -2,
      allocations: [
        { contributor: 'Arhaan', amount: -1 },
        { contributor: 'Sam', amount: -1 },
      ],
      note: 'Duplicate group entry',
    });
  });

  it('retains the same idempotency key after an uncertain failure and preserves the form', async () => {
    const submit = vi
      .fn<(payload: EntryPayload) => Promise<void>>()
      .mockRejectedValueOnce(new ApiRequestError('The request timed out.', 0, true))
      .mockResolvedValueOnce();
    const { user } = setup(submit);
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    await enterGroupNames(user);
    await user.click(screen.getByRole('button', { name: 'Review group entry' }));
    await user.click(screen.getByRole('button', { name: 'Confirm entry' }));
    expect(await screen.findByText('The request timed out.')).toBeInTheDocument();
    expect(screen.getByText('Record 2 beers across 2 people?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm entry' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[0]?.[0].idempotencyKey).toBe(submit.mock.calls[1]?.[0].idempotencyKey);
  });

  it('uses a fresh idempotency key for a genuinely new submission', async () => {
    const { submit, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Split between people' }));
    await enterGroupNames(user);
    await user.click(screen.getByRole('button', { name: 'Review group entry' }));
    await user.click(screen.getByRole('button', { name: 'Confirm entry' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Record +1 beers' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      submit.mock.calls[1]?.[0].idempotencyKey,
    );
  });
});
