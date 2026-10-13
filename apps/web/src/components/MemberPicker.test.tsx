import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMembers } from '../lib/api';
import type { CrewMember } from '../lib/types';
import { MemberPicker } from './MemberPicker';

vi.mock('../lib/api', () => ({ fetchMembers: vi.fn(), createMember: vi.fn() }));

const member: CrewMember = {
  id: 'member-sam',
  displayName: 'Sam',
  aliases: [],
  allocationCount: 1,
  participationCount: 1,
  netTotal: 1,
  lastRecordedAt: null,
};

function Picker({ onEscape = vi.fn() }: { onEscape?: () => void }) {
  const [value, setValue] = useState('');
  const [memberId, setMemberId] = useState<string>();
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape') onEscape();
      }}
    >
      <MemberPicker
        label="Contributor"
        enabled
        value={value}
        memberId={memberId}
        onChange={(name, id) => {
          setValue(name);
          setMemberId(id);
        }}
      />
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(fetchMembers).mockResolvedValue({ members: [member], nextCursor: null });
});

describe('member directory interaction', () => {
  it('returns keyboard focus to the contributor after selecting a result', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    await user.click(screen.getByRole('button', { name: 'Find in the full crew directory' }));
    await user.click(await screen.findByRole('button', { name: 'Select Sam' }));
    expect(screen.getByLabelText('Contributor')).toHaveValue('Sam');
    expect(screen.getByLabelText('Contributor')).toHaveFocus();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('closes the directory with Escape before allowing the enclosing dialog to close', async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Picker onEscape={onEscape} />);
    await user.click(screen.getByRole('button', { name: 'Find in the full crew directory' }));
    (await screen.findByRole('button', { name: 'Select Sam' })).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Contributor')).toHaveFocus();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(onEscape).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('immediately hides old matches when the query changes', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    await user.click(screen.getByRole('button', { name: 'Find in the full crew directory' }));
    expect(await screen.findByRole('button', { name: 'Select Sam' })).toBeInTheDocument();
    vi.mocked(fetchMembers).mockResolvedValue({ members: [], nextCursor: null });
    fireEvent.change(screen.getByLabelText('Contributor'), { target: { value: 'Jo' } });
    expect(screen.queryByRole('button', { name: 'Select Sam' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Searching crew…');
    expect(screen.queryByText('No matching public members.')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('No matching public members.'),
    );
  });
});
