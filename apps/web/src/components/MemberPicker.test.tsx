import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createMember, fetchMembers } from '../lib/api';
import type * as Api from '../lib/api';
import type { CrewMember } from '../lib/types';
import { MemberPicker } from './MemberPicker';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  fetchMembers: vi.fn(),
  createMember: vi.fn(),
}));

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

  it('reconciles a lost creation response with the directory without creating again', async () => {
    let created = false;
    vi.mocked(fetchMembers).mockImplementation((query) =>
      Number(new URLSearchParams(query).get('limit')) > 50
        ? Promise.reject(new ApiRequestError('limit must be from 1 to 50.', 400))
        : Promise.resolve({
            members: created ? [member] : [],
            nextCursor: null,
          }),
    );
    vi.mocked(createMember).mockImplementation(() => {
      created = true;
      return Promise.reject(new ApiRequestError('Response lost.', 0, true));
    });
    const onChange = vi.fn();
    render(
      <MemberPicker label="Contributor" enabled value="Sam" token="editor" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Find in the full crew directory' }));
    const button = await screen.findByRole('button', { name: 'Create “Sam” as a member' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Sam', 'member-sam'));
    expect(createMember).toHaveBeenCalledOnce();
    expect(fetchMembers).toHaveBeenCalledWith('q=Sam&limit=50');
  });

  it('preserves the typed name and requests login after member-creation session expiry', async () => {
    vi.mocked(fetchMembers).mockResolvedValue({ members: [], nextCursor: null });
    vi.mocked(createMember).mockRejectedValue(new ApiRequestError('Session expired.', 401));
    const onLogin = vi.fn();
    render(
      <MemberPicker
        label="Contributor"
        enabled
        value="Sam"
        token="expired"
        onChange={vi.fn()}
        onLogin={onLogin}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Find in the full crew directory' }));
    const button = await screen.findByRole('button', { name: 'Create “Sam” as a member' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Contributor')).toHaveValue('Sam');
    expect(screen.getByRole('alert')).toHaveTextContent('Your name is preserved');
  });

  it('checks an existing exact alias before dispatch after reopening an uncertain creation', async () => {
    const onChange = vi.fn();
    render(
      <MemberPicker label="Contributor" enabled value="Sam" token="editor" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Find in the full crew directory' }));
    const button = await screen.findByRole('button', { name: 'Create “Sam” as a member' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Sam', 'member-sam'));
    expect(createMember).not.toHaveBeenCalled();
  });

  it('reconciles normalized aliases when public text search has different Unicode matching', async () => {
    vi.mocked(fetchMembers).mockImplementation((query) =>
      Promise.resolve({
        members: new URLSearchParams(query).has('q') ? [] : [member],
        nextCursor: null,
      }),
    );
    const onChange = vi.fn();
    render(
      <MemberPicker
        label="Contributor"
        enabled
        value="Ｓａｍ"
        token="editor"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Find in the full crew directory' }));
    const button = screen.getByRole('button', { name: 'Create “Ｓａｍ” as a member' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Sam', 'member-sam'));
    expect(createMember).not.toHaveBeenCalled();
  });
});
