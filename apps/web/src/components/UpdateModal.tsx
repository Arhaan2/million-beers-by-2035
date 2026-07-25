import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiRequestError } from '../lib/api';
import type { EventPayload } from '../lib/types';
import { validateUpdate } from '../lib/updateValidation';

const QUICK_AMOUNTS = [1, 2, 4, 6, 12, 24];
const CONTRIBUTOR_KEY = 'million-beers-contributor';

function trapFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
    ),
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function UpdateModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: EventPayload) => Promise<void>;
}) {
  const [amount, setAmount] = useState(1);
  const [contributor, setContributor] = useState(() => localStorage.getItem(CONTRIBUTOR_KEY) ?? '');
  const [note, setNote] = useState('');
  const [correction, setCorrection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const firstButton = useRef<HTMLButtonElement>(null);

  const resetKey = () => {
    if (!submitting) idempotencyKey.current = null;
  };

  useEffect(() => {
    if (open) window.setTimeout(() => firstButton.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  const resetForm = () => {
    setAmount(1);
    setNote('');
    setCorrection(false);
    setError(null);
    idempotencyKey.current = null;
  };

  const close = () => {
    resetForm();
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validateUpdate(amount, correction, note);
    if (validation) {
      setError(validation);
      return;
    }
    const signedAmount = correction ? -amount : amount;
    if (correction && !window.confirm(`Record a correction of -${amount} beers?`)) return;
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    setSubmitting(true);
    setError(null);
    try {
      const trimmedContributor = contributor.trim();
      if (trimmedContributor) localStorage.setItem(CONTRIBUTOR_KEY, trimmedContributor);
      await onSubmit({
        amount: signedAmount,
        contributor: trimmedContributor,
        note: note.trim(),
        idempotencyKey: key,
      });
      resetForm();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'The update could not be recorded.',
      );
    } finally {
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
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !submitting) close();
          trapFocus(event);
        }}
      >
        <button
          ref={firstButton}
          className="modal__close"
          type="button"
          aria-label="Close update form"
          onClick={close}
          disabled={submitting}
        >
          ×
        </button>
        <p className="eyebrow">Append to the ledger</p>
        <h2 id="update-title">{correction ? 'Record a correction' : 'Add beers'}</h2>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset>
            <legend>Quick amount</legend>
            <div className="quick-grid">
              {QUICK_AMOUNTS.map((value) => (
                <button
                  key={value}
                  className={amount === value ? 'selected' : ''}
                  type="button"
                  onClick={() => {
                    setAmount(value);
                    resetKey();
                  }}
                >
                  +{value}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="form-grid">
            <div>
              <label htmlFor="custom-amount">Custom amount</label>
              <input
                id="custom-amount"
                type="number"
                inputMode="numeric"
                min="1"
                max="250"
                step="1"
                value={amount}
                onChange={(event) => {
                  setAmount(Number(event.target.value));
                  resetKey();
                }}
              />
            </div>
            <div>
              <label htmlFor="contributor">Contributor / nickname</label>
              <input
                id="contributor"
                maxLength={30}
                autoComplete="nickname"
                placeholder="Anonymous"
                value={contributor}
                onChange={(event) => {
                  setContributor(event.target.value);
                  resetKey();
                }}
              />
            </div>
          </div>
          <label htmlFor="event-note">{correction ? 'Correction reason' : 'Note (optional)'}</label>
          <textarea
            id="event-note"
            maxLength={140}
            rows={3}
            placeholder={correction ? 'Why is this being corrected?' : 'Friday drinks'}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              resetKey();
            }}
          />
          <div className="form-meta">
            <span>{note.length}/140</span>
          </div>
          <label className="correction-toggle">
            <input
              type="checkbox"
              checked={correction}
              onChange={(event) => {
                setCorrection(event.target.checked);
                resetKey();
              }}
            />
            <span>
              <strong>Correction mode</strong>
              <small>Creates a separate negative entry. History is never rewritten.</small>
            </span>
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className={`button button--full ${correction ? 'button--danger' : 'button--primary'}`}
            disabled={submitting}
          >
            {submitting
              ? 'Recording…'
              : correction
                ? `Review correction of -${amount}`
                : `Record +${amount} beers`}
          </button>
        </form>
      </div>
    </div>
  );
}
