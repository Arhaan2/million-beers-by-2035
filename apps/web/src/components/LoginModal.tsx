import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiRequestError } from '../lib/api';
import type { EditorSession } from '../lib/types';

function trapFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled])',
    ),
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function LoginModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (code: string) => Promise<EditorSession>;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  const close = () => {
    setCode('');
    setError(null);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(code);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError && caught.status === 429
          ? 'Too many attempts. Please wait before trying again.'
          : 'That crew code was not accepted.',
      );
    } finally {
      setCode('');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) close();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !submitting) close();
          trapFocus(event);
        }}
      >
        <button
          className="modal__close"
          type="button"
          aria-label="Close login"
          onClick={close}
          disabled={submitting}
        >
          ×
        </button>
        <p className="eyebrow">Crew access</p>
        <h2 id="login-title">Step behind the bar</h2>
        <p className="modal__intro">
          Enter the shared crew code to record an update or correction.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="crew-code">Crew code</label>
          <input
            ref={inputRef}
            id="crew-code"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={64}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, ''))}
            aria-describedby={error ? 'login-error' : undefined}
          />
          {error ? (
            <p className="form-error" id="login-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="button button--primary button--full" disabled={!code || submitting}>
            {submitting ? 'Checking…' : 'Unlock editor'}
          </button>
        </form>
        <p className="modal__privacy">
          The code is sent only to the Worker for validation and is never stored in this browser.
        </p>
      </div>
    </div>
  );
}
