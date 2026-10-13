import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EditorSession } from '../lib/types';
import { LoginModal } from './LoginModal';

describe('crew login interaction', () => {
  it('focuses the code, locks page scrolling, and returns focus to its trigger', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    document.body.style.overflow = 'auto';
    const view = render(
      <LoginModal open onClose={vi.fn()} onSubmit={vi.fn<() => Promise<EditorSession>>()} />,
    );
    expect(screen.getByLabelText('Crew code')).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('auto');
    trigger.remove();
    document.body.style.overflow = '';
  });

  it('keeps a failed code accessible and ready to replace', async () => {
    const user = userEvent.setup();
    render(
      <LoginModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn<() => Promise<EditorSession>>().mockRejectedValue(new Error('Rejected'))}
      />,
    );
    const input = screen.getByLabelText('Crew code');
    await user.type(input, 'wrong-code');
    await user.click(screen.getByRole('button', { name: 'Unlock editor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That crew code was not accepted.');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.type(input, 'replacement');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dispatches only once while a login is pending', async () => {
    let complete!: (session: EditorSession) => void;
    const submit = vi.fn<() => Promise<EditorSession>>(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(<LoginModal open onClose={vi.fn()} onSubmit={submit} />);
    const input = screen.getByLabelText('Crew code');
    fireEvent.change(input, { target: { value: 'crew-code' } });
    const form = input.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);
    expect(submit).toHaveBeenCalledOnce();
    expect(input).toHaveAttribute('readonly');
    complete({ token: 'session-token', expiresAt: 999999 });
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'));
  });
});
