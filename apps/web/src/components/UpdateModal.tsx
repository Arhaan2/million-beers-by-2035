import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiRequestError } from '../lib/api';
import {
  allocationSum,
  equalSplit,
  remainingAllocation,
  toSignedAllocations,
  validateGroupEntry,
  type AllocationDraft,
} from '../lib/entryAllocations';
import type { EntryPayload } from '../lib/types';
import { validateUpdate } from '../lib/updateValidation';

const QUICK_AMOUNTS = [1, 2, 4, 6, 12, 24];
const CONTRIBUTOR_KEY = 'million-beers-contributor';

interface ParticipantDraft extends AllocationDraft {
  id: string;
}

function newParticipant(amount = 1): ParticipantDraft {
  return { id: crypto.randomUUID(), contributor: '', amount };
}

function initialParticipants(): ParticipantDraft[] {
  return [newParticipant(), newParticipant()];
}

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
  suggestedContributors = [],
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: EntryPayload) => Promise<void>;
  suggestedContributors?: string[];
}) {
  const [mode, setMode] = useState<'single' | 'group'>('single');
  const [amount, setAmount] = useState(1);
  const [groupTotal, setGroupTotal] = useState(2);
  const [participants, setParticipants] = useState<ParticipantDraft[]>(initialParticipants);
  const [contributor, setContributor] = useState(() => localStorage.getItem(CONTRIBUTOR_KEY) ?? '');
  const [note, setNote] = useState('');
  const [correction, setCorrection] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const participantInputs = useRef(new Map<string, HTMLInputElement>());

  const resetKey = () => {
    if (!submitting) idempotencyKey.current = null;
    setReviewing(false);
    setError(null);
  };

  useEffect(() => {
    if (open) window.setTimeout(() => firstButton.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (reviewing) reviewHeading.current?.focus();
  }, [reviewing]);

  if (!open) return null;

  const resetForm = () => {
    setMode('single');
    setAmount(1);
    setGroupTotal(2);
    setParticipants(initialParticipants());
    setNote('');
    setCorrection(false);
    setReviewing(false);
    setError(null);
    idempotencyKey.current = null;
  };

  const close = () => {
    resetForm();
    onClose();
  };

  const submitPayload = async (payload: Omit<EntryPayload, 'idempotencyKey'>) => {
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ ...payload, idempotencyKey: key });
      resetForm();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'The update could not be recorded.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitSingle = async () => {
    const validation = validateUpdate(amount, correction, note);
    if (validation) {
      setError(validation);
      return;
    }
    if (correction && !window.confirm(`Record a correction of -${amount} beers?`)) return;
    const trimmedContributor = contributor.trim();
    if (trimmedContributor) localStorage.setItem(CONTRIBUTOR_KEY, trimmedContributor);
    const signedAmount = correction ? -amount : amount;
    await submitPayload({
      totalAmount: signedAmount,
      allocations: [{ contributor: trimmedContributor, amount: signedAmount }],
      note: note.trim(),
    });
  };

  const reviewGroup = (event: FormEvent) => {
    event.preventDefault();
    const validation = validateGroupEntry(groupTotal, participants, correction, note);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setReviewing(true);
  };

  const confirmGroup = async () => {
    const validation = validateGroupEntry(groupTotal, participants, correction, note);
    if (validation) {
      setReviewing(false);
      setError(validation);
      return;
    }
    await submitPayload({
      totalAmount: correction ? -groupTotal : groupTotal,
      allocations: toSignedAllocations(participants, correction),
      note: note.trim(),
    });
  };

  const addParticipant = () => {
    if (participants.length >= 25) return;
    const participant = newParticipant();
    setParticipants((current) => [...current, participant]);
    resetKey();
    window.setTimeout(() => participantInputs.current.get(participant.id)?.focus(), 0);
  };

  const removeParticipant = (participantId: string) => {
    if (participants.length <= 2) return;
    const index = participants.findIndex((participant) => participant.id === participantId);
    const focusTarget = participants[index - 1]?.id ?? participants[index + 1]?.id;
    setParticipants((current) => current.filter((participant) => participant.id !== participantId));
    resetKey();
    if (focusTarget) {
      window.setTimeout(() => participantInputs.current.get(focusTarget)?.focus(), 0);
    }
  };

  const splitEqually = () => {
    const split = equalSplit(groupTotal, participants.length);
    if (split.length === 0) return;
    setParticipants((current) =>
      current.map((participant, index) => ({ ...participant, amount: split[index] ?? 1 })),
    );
    resetKey();
  };

  const allocated = allocationSum(participants);
  const remaining = remainingAllocation(groupTotal, participants);
  const groupValidation = validateGroupEntry(groupTotal, participants, correction, note);
  const allocationMessage =
    remaining === 0
      ? `${allocated} of ${groupTotal} allocated`
      : remaining > 0
        ? `${remaining} beer${remaining === 1 ? '' : 's'} left to allocate`
        : `Allocated ${Math.abs(remaining)} beer${remaining === -1 ? '' : 's'} too many`;

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
        {reviewing ? (
          <div className="entry-review">
            <h2 id="update-title" ref={reviewHeading} tabIndex={-1}>
              Review group entry
            </h2>
            <p className="entry-review__question">
              {correction
                ? `Record a correction of ${groupTotal} beers across ${participants.length} people?`
                : `Record ${groupTotal} beers across ${participants.length} people?`}
            </p>
            <ul className="entry-review__allocations">
              {participants.map((participant) => (
                <li key={participant.id}>
                  <span>{participant.contributor.trim()}</span>
                  <strong>
                    {correction ? '−' : '+'}
                    {participant.amount}
                  </strong>
                </li>
              ))}
            </ul>
            {note.trim() ? (
              <p className="entry-review__note">
                <strong>{correction ? 'Correction reason:' : 'Note:'}</strong> {note.trim()}
              </p>
            ) : null}
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="entry-review__actions">
              <button
                className="button button--quiet"
                type="button"
                disabled={submitting}
                onClick={() => setReviewing(false)}
              >
                Back to edit
              </button>
              <button
                className={`button ${correction ? 'button--danger' : 'button--primary'}`}
                type="button"
                disabled={submitting}
                onClick={() => void confirmGroup()}
              >
                {submitting ? 'Recording…' : correction ? 'Confirm correction' : 'Confirm entry'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 id="update-title">{correction ? 'Record a correction' : 'Add beers'}</h2>
            <fieldset className="entry-mode" aria-label="Entry type">
              <legend>Who is this entry for?</legend>
              <div className="entry-mode__buttons">
                <button
                  type="button"
                  className={mode === 'single' ? 'selected' : ''}
                  aria-pressed={mode === 'single'}
                  onClick={() => {
                    setMode('single');
                    resetKey();
                  }}
                >
                  Single person
                </button>
                <button
                  type="button"
                  className={mode === 'group' ? 'selected' : ''}
                  aria-pressed={mode === 'group'}
                  onClick={() => {
                    setMode('group');
                    resetKey();
                  }}
                >
                  Split between people
                </button>
              </div>
            </fieldset>

            {mode === 'single' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitSingle();
                }}
              >
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
                      list="known-contributors"
                      value={contributor}
                      onChange={(event) => {
                        setContributor(event.target.value);
                        resetKey();
                      }}
                    />
                  </div>
                </div>
                <label htmlFor="event-note">
                  {correction ? 'Correction reason' : 'Note (optional)'}
                </label>
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
            ) : (
              <form onSubmit={reviewGroup}>
                <div className="group-total-row">
                  <div>
                    <label htmlFor="group-total">
                      {correction ? 'Total correction' : 'Total beers'}
                    </label>
                    <input
                      id="group-total"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="250"
                      step="1"
                      value={groupTotal}
                      aria-describedby="allocation-status"
                      onChange={(event) => {
                        setGroupTotal(Number(event.target.value));
                        resetKey();
                      }}
                    />
                  </div>
                  <button
                    className="button button--outline"
                    type="button"
                    disabled={groupTotal < participants.length || groupTotal > 250}
                    onClick={splitEqually}
                  >
                    Split equally
                  </button>
                </div>
                {groupTotal < participants.length ? (
                  <p className="group-help">
                    The total must be at least the number of people before it can be split equally.
                  </p>
                ) : null}

                <fieldset className="participant-fieldset">
                  <legend>Participants</legend>
                  <div className="participant-list">
                    {participants.map((participant, index) => (
                      <div className="participant-row" key={participant.id}>
                        <div className="participant-row__name">
                          <label htmlFor={`participant-${participant.id}`}>
                            Person {index + 1}
                          </label>
                          <input
                            ref={(element) => {
                              if (element) participantInputs.current.set(participant.id, element);
                              else participantInputs.current.delete(participant.id);
                            }}
                            id={`participant-${participant.id}`}
                            maxLength={30}
                            list="known-contributors"
                            autoComplete="off"
                            placeholder="Name or nickname"
                            value={participant.contributor}
                            onChange={(event) => {
                              const value = event.target.value;
                              setParticipants((current) =>
                                current.map((candidate) =>
                                  candidate.id === participant.id
                                    ? { ...candidate, contributor: value }
                                    : candidate,
                                ),
                              );
                              resetKey();
                            }}
                          />
                        </div>
                        <div className="participant-row__amount">
                          <label htmlFor={`allocation-${participant.id}`}>Beers</label>
                          <input
                            id={`allocation-${participant.id}`}
                            aria-label={`Beer allocation for participant ${index + 1}`}
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max="250"
                            step="1"
                            value={participant.amount}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setParticipants((current) =>
                                current.map((candidate) =>
                                  candidate.id === participant.id
                                    ? { ...candidate, amount: value }
                                    : candidate,
                                ),
                              );
                              resetKey();
                            }}
                          />
                        </div>
                        {participants.length > 2 ? (
                          <button
                            className="participant-row__remove"
                            type="button"
                            aria-label={`Remove ${participant.contributor.trim() || `participant ${index + 1}`}`}
                            onClick={() => removeParticipant(participant.id)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button
                    className="button button--quiet add-person"
                    type="button"
                    disabled={participants.length >= 25}
                    onClick={addParticipant}
                  >
                    Add person
                  </button>
                </fieldset>

                <p
                  id="allocation-status"
                  className={`allocation-status ${remaining === 0 ? 'allocation-status--exact' : 'allocation-status--mismatch'}`}
                  aria-live="polite"
                >
                  <strong>{allocationMessage}</strong>
                  <span>Allocations must match the total exactly.</span>
                </p>

                <label htmlFor="group-note">
                  {correction ? 'Correction reason' : 'Shared note (optional)'}
                </label>
                <textarea
                  id="group-note"
                  maxLength={140}
                  rows={3}
                  placeholder={
                    correction ? 'Why is this group entry being corrected?' : 'Friday night hangout'
                  }
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
                    <small>
                      Enter positive values here; the saved allocations will be negative.
                    </small>
                  </span>
                </label>
                {groupValidation && remaining === 0 ? (
                  <p className="group-help" role="status">
                    {groupValidation}
                  </p>
                ) : null}
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  className={`button button--full ${correction ? 'button--danger' : 'button--primary'}`}
                  disabled={submitting || Boolean(groupValidation)}
                >
                  {correction ? 'Review group correction' : 'Review group entry'}
                </button>
              </form>
            )}
          </>
        )}
        <datalist id="known-contributors">
          {suggestedContributors.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
