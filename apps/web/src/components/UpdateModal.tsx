import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiRequestError } from '../lib/api';
import { allocationSum, equalSplit, validateGroupEntry } from '../lib/entryAllocations';
import {
  clearDraft,
  persistEditableDraft,
  discardEditableDraft,
  DRAFT_KEY,
  downloadDraft,
  getDraftStatus,
  isDraftShared,
  makeDraft,
  readDraft,
  readGroups,
  saveGroup,
  saveRecentParticipants,
  withDraftLock,
  writeDraft,
  type DraftRecord,
  type FormDraft,
  type ParticipantDraft,
} from '../lib/drafts';
import { occurrencePayload } from '../lib/occurrence';
import type { BeerEntry, Capabilities, EntryPayload } from '../lib/types';
import { validateUpdate } from '../lib/updateValidation';
import { MemberPicker } from './MemberPicker';

const QUICK_AMOUNTS = [1, 2, 4, 6, 12, 24];
const person = (): ParticipantDraft => ({ id: crypto.randomUUID(), contributor: '', amount: 1 });
function newForm(source?: BeerEntry): FormDraft {
  const participants = source?.allocations
    .filter((allocation) => (allocation.remainingCorrectable ?? 0) > 0)
    .map((allocation) => ({
      id: crypto.randomUUID(),
      contributor: allocation.contributor,
      amount: allocation.remainingCorrectable ?? 0,
      maximum: allocation.remainingCorrectable ?? 0,
      memberId: allocation.memberId ?? undefined,
      sourceAllocationId: allocation.id,
    })) ?? [person(), person()];
  return {
    mode: source ? 'group' : 'single',
    amount: 1,
    groupTotal: source ? allocationSum(participants) : 2,
    participants,
    contributor: '',
    note: '',
    correction: Boolean(source),
    correctionOfEntryId: source?.id,
    memory: {},
    date: '',
    time: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, a[href]',
    ),
  ).filter((element) => !element.closest('details:not([open])') || element.tagName === 'SUMMARY');
  const first = controls[0],
    last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
export function UpdateModal({
  open,
  onClose,
  onSubmit,
  capabilities,
  token,
  initialCorrection,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: EntryPayload) => Promise<void>;
  suggestedContributors?: string[];
  capabilities?: Capabilities | undefined;
  token?: string | undefined;
  initialCorrection?: BeerEntry | undefined;
}) {
  const [initial] = useState(() => readDraft());
  const [form, setForm] = useState<FormDraft>(() => initial?.form ?? newForm(initialCorrection));
  const [attempt, setAttempt] = useState<DraftRecord['attempt']>(() =>
    initial?.attempt
      ? { ...initial.attempt, state: initial.attempt.state === 'auth' ? 'auth' : 'unknown' }
      : undefined,
  );
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [storageNotice, setStorageNotice] = useState(getDraftStatus);
  const [groups, setGroups] = useState(readGroups);
  const firstButton = useRef<HTMLButtonElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const inFlight = useRef(false);
  const { mode, amount, groupTotal, participants, contributor, note, correction } = form;
  const linked = Boolean(form.correctionOfEntryId);
  const patch = (value: Partial<FormDraft>) => {
    if (attempt || inFlight.current) return;
    setForm((current) => ({ ...current, ...value }));
    setReviewing(false);
    setError(null);
  };
  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => firstButton.current?.focus(), 0);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previous;
      returnTo?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (reviewing || attempt) reviewHeading.current?.focus();
  }, [reviewing, attempt]);
  useEffect(() => {
    if (!open || attempt) return;
    let current = true;
    void persistEditableDraft(form, () => current).then(() => {
      if (current) setStorageNotice(getDraftStatus());
    });
    return () => {
      current = false;
    };
  }, [form, attempt, open]);
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key !== DRAFT_KEY || inFlight.current) return;
      const stored = readDraft();
      if (stored?.attempt) {
        setForm(stored.form);
        setAttempt({ ...stored.attempt, state: 'unknown' });
        setError('An unresolved submission from another tab is ready to check.');
      }
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);
  if (!open) return null;

  const selectedIds = participants.flatMap((item) => (item.memberId ? [item.memberId] : []));
  const duplicateMember = new Set(selectedIds).size !== selectedIds.length;
  const groupValidation = duplicateMember
    ? 'Each member can appear only once, even through an alias.'
    : linked
      ? !participants.some((item) => item.amount > 0)
        ? 'Choose an amount to correct.'
        : participants.some(
              (item) =>
                !Number.isInteger(item.amount) ||
                item.amount < 0 ||
                item.amount > (item.maximum ?? 0),
            )
          ? 'Each reversal must stay within the remaining correctable allocation.'
          : allocationSum(participants) > 250
            ? 'Correct at most 250 in one entry.'
            : note.trim().length < 4
              ? 'Corrections require a reason of at least 4 characters.'
              : null
      : validateGroupEntry(groupTotal, participants, correction, note);
  const allocated = allocationSum(participants),
    remaining = groupTotal - allocated;
  const groupMessage =
    remaining === 0
      ? `${allocated} of ${groupTotal} allocated`
      : remaining > 0
        ? `${remaining} beer${remaining === 1 ? '' : 's'} left to allocate`
        : `Allocated ${Math.abs(remaining)} beer${remaining === -1 ? '' : 's'} too many`;
  const metadata = () => {
    const memory = Object.fromEntries(
      Object.entries(form.memory)
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
    );
    return {
      ...(capabilities?.occurrence ? occurrencePayload(form.date, form.time, form.timezone) : {}),
      ...(capabilities?.enhancedLogging && Object.keys(memory).length
        ? { memory: { ...memory, visibility: 'public' as const } }
        : {}),
    };
  };
  const buildPayload = (): Omit<EntryPayload, 'idempotencyKey'> => {
    const sign = correction ? -1 : 1;
    const allocations =
      mode === 'single'
        ? [
            {
              contributor: contributor.trim(),
              amount: sign * amount,
              ...(form.memberId ? { memberId: form.memberId } : {}),
            },
          ]
        : participants
            .filter((item) => !linked || item.amount > 0)
            .map((item) => ({
              contributor: item.contributor.trim(),
              amount: sign * item.amount,
              ...(item.memberId ? { memberId: item.memberId } : {}),
              ...(item.sourceAllocationId ? { sourceAllocationId: item.sourceAllocationId } : {}),
            }));
    return {
      totalAmount: sign * (mode === 'single' ? amount : linked ? allocated : groupTotal),
      allocations,
      note: note.trim(),
      ...metadata(),
      ...(form.correctionOfEntryId ? { correctionOfEntryId: form.correctionOfEntryId } : {}),
    };
  };
  const submitPayload = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const acquired = await withDraftLock(async () => {
        const stored = readDraft();
        if (
          stored?.attempt &&
          stored.attempt.payload.idempotencyKey !== attempt?.payload.idempotencyKey
        ) {
          setForm(stored.form);
          setAttempt({ ...stored.attempt, state: 'unknown' });
          throw new Error('Resolve the saved submission before starting another entry.');
        }
        const payload = attempt?.payload ?? {
          ...buildPayload(),
          idempotencyKey: crypto.randomUUID(),
        };
        const pending = { payload, state: 'submitting' as const };
        // Durability is established before dispatch, never after a timeout.
        if (!writeDraft(makeDraft(form, pending))) {
          writeDraft(makeDraft(form));
          setStorageNotice(getDraftStatus());
          throw new Error(
            'Recording paused: browser storage is unavailable. Your draft has not been sent.',
          );
        }
        if (!attempt && !isDraftShared(payload.idempotencyKey)) {
          writeDraft(makeDraft(form));
          throw new Error(
            'Recording paused: this browser only provides tab storage, so new entries cannot be coordinated across tabs. Your unsent draft is preserved here. Enable device storage to record.',
          );
        }
        setAttempt(pending);
        try {
          await onSubmit(payload);
          if (payload.totalAmount > 0) saveRecentParticipants(payload.allocations);
          if (mode === 'group' && !correction) {
            saveGroup({
              name: 'Last group',
              people: participants.map(({ contributor, memberId }) => ({ contributor, memberId })),
            });
            setGroups(readGroups());
          }
          clearDraft(payload.idempotencyKey);
          setAttempt(undefined);
          setForm(newForm());
          setReviewing(false);
        } catch (caught) {
          const definitive =
            caught instanceof ApiRequestError &&
            caught.status >= 400 &&
            caught.status < 500 &&
            caught.status !== 401 &&
            caught.status !== 408 &&
            caught.status !== 429;
          if (definitive) {
            writeDraft(makeDraft(form));
            setAttempt(undefined);
            setReviewing(false);
            setError(`Rejected: ${caught.message}`);
          } else {
            const unresolved = {
              payload,
              state:
                caught instanceof ApiRequestError && caught.status === 401
                  ? ('auth' as const)
                  : ('unknown' as const),
            };
            writeDraft(makeDraft(form, unresolved));
            setAttempt(unresolved);
            setError(
              caught instanceof Error
                ? caught.message
                : 'Submission status unknown. Retry this saved attempt.',
            );
          }
        }
        return true;
      }, Boolean(attempt));
      if (!acquired)
        setError('Another tab is resolving an entry. Wait for it to finish, then try again.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The entry could not be prepared.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
      setStorageNotice(getDraftStatus());
    }
  };
  const submitSingle = () => {
    const validation = validateUpdate(amount, correction, note);
    if (validation) {
      setError(validation);
      return;
    }
    if (capabilities?.enhancedLogging && contributor.trim() && !form.memberId) {
      setError('Select a member from the directory or intentionally create this name first.');
      return;
    }
    if (correction && !window.confirm(`Record a correction of -${amount} beers?`)) return;
    void submitPayload();
  };
  const reviewGroup = () => {
    if (groupValidation) {
      setError(groupValidation);
      return;
    }
    if (capabilities?.enhancedLogging && !linked && participants.some((item) => !item.memberId)) {
      setError('Select or intentionally create a member for each participant.');
      return;
    }
    try {
      buildPayload();
      setReviewing(true);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check the occurrence date.');
    }
  };
  const updatePerson = (id: string, value: Partial<ParticipantDraft>) => {
    const next = participants.map((item) => (item.id === id ? { ...item, ...value } : item));
    patch({ participants: next, ...(linked ? { groupTotal: allocationSum(next) } : {}) });
  };
  const restoreGroup = (name: string) => {
    const group = groups.find((item) => item.name === name);
    if (!group) return;
    const next = group.people.map((item) => ({ ...item, id: crypto.randomUUID(), amount: 1 }));
    patch({ mode: 'group', participants: next, groupTotal: next.length, correction: false });
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          trapFocus(event);
        }}
      >
        <button
          ref={firstButton}
          className="modal__close"
          type="button"
          aria-label="Close update form"
          onClick={onClose}
        >
          ×
        </button>
        <p className="eyebrow">Append to the ledger</p>
        {reviewing || attempt ? (
          <div className="entry-review">
            <h2 id="update-title" ref={reviewHeading} tabIndex={-1}>
              {attempt
                ? submitting
                  ? 'Recording entry…'
                  : 'Resolve saved submission'
                : 'Review group entry'}
            </h2>
            <p className="entry-review__question">
              {correction
                ? `Record a correction of ${groupTotal} beers across ${participants.length} people?`
                : mode === 'group'
                  ? `Record ${groupTotal} beers across ${participants.length} people?`
                  : `Record ${amount} beer${amount === 1 ? '' : 's'}?`}
            </p>
            <ul className="entry-review__allocations">
              {(attempt?.payload.allocations ?? buildPayload().allocations).map((item, index) => (
                <li key={index}>
                  <span>{item.contributor || 'Anonymous'}</span>
                  <strong>
                    {item.amount > 0 ? '+' : '−'}
                    {Math.abs(item.amount)}
                  </strong>
                </li>
              ))}
            </ul>
            {note.trim() ? (
              <p className="entry-review__note">
                <strong>{correction ? 'Correction reason:' : 'Note:'}</strong> {note.trim()}
              </p>
            ) : null}
            {form.memory.title ? <p className="helper">Occasion: {form.memory.title}</p> : null}
            {form.date ? (
              <p className="helper">
                Happened on {form.date}
                {form.time ? ` at ${form.time}` : ''} · {form.timezone}
              </p>
            ) : null}
            {attempt ? (
              <p className="notice" role="status">
                {submitting
                  ? 'Your exact payload and retry key are saved before sending.'
                  : attempt.state === 'auth'
                    ? 'Sign in again, then retry this saved attempt. Its original payload and key are preserved.'
                    : 'Submission status is unknown. The form is locked to its original payload and key. Checking it again cannot create a duplicate.'}
              </p>
            ) : (
              <p className="helper">
                Review every allocation. All submitted display names and memory fields are public.
              </p>
            )}
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
                onClick={() => (attempt ? onClose() : setReviewing(false))}
              >
                {attempt ? 'Keep and close' : 'Back to edit'}
              </button>
              <button
                className={`button ${correction ? 'button--danger' : 'button--primary'}`}
                type="button"
                disabled={submitting}
                onClick={() => void submitPayload()}
              >
                {submitting
                  ? 'Recording…'
                  : attempt
                    ? 'Retry saved attempt'
                    : correction
                      ? 'Confirm correction'
                      : 'Confirm entry'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 id="update-title">
              {linked ? 'Correct this entry' : correction ? 'Record a correction' : 'Record entry'}
            </h2>
            {initialCorrection && form.correctionOfEntryId !== initialCorrection.id ? (
              <p className="notice">
                Your saved draft has been restored first. Finish it or discard it below to correct
                the selected entry.
              </p>
            ) : null}
            {linked ? (
              <p className="helper">
                A linked reversal appends a new record. Enter zero to leave a participant unchanged.
                The server checks each remaining allowance atomically.
              </p>
            ) : (
              <fieldset className="entry-mode" aria-label="Entry type">
                <legend>Who is this entry for?</legend>
                <div className="entry-mode__buttons">
                  <button
                    type="button"
                    className={mode === 'single' ? 'selected' : ''}
                    aria-pressed={mode === 'single'}
                    onClick={() => patch({ mode: 'single' })}
                  >
                    Single person
                  </button>
                  <button
                    type="button"
                    className={mode === 'group' ? 'selected' : ''}
                    aria-pressed={mode === 'group'}
                    onClick={() => patch({ mode: 'group' })}
                  >
                    Split between people
                  </button>
                </div>
              </fieldset>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (mode === 'single') submitSingle();
                else reviewGroup();
              }}
            >
              {mode === 'single' ? (
                <>
                  <fieldset>
                    <legend>Quick amount</legend>
                    <div className="quick-grid">
                      {QUICK_AMOUNTS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={amount === value ? 'selected' : ''}
                          onClick={() => patch({ amount: value })}
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
                        onChange={(event) => patch({ amount: Number(event.target.value) })}
                      />
                    </div>
                    <MemberPicker
                      label="Contributor / nickname"
                      inputId="contributor"
                      value={contributor}
                      memberId={form.memberId}
                      enabled={Boolean(capabilities?.enhancedLogging)}
                      token={capabilities?.memberCreation ? token : undefined}
                      onChange={(contributor, memberId) => patch({ contributor, memberId })}
                    />
                  </div>
                </>
              ) : (
                <>
                  {!linked ? (
                    <div className="saved-groups">
                      <button
                        type="button"
                        className="text-button"
                        disabled={!groups.some((group) => group.name === 'Last group')}
                        onClick={() => restoreGroup('Last group')}
                      >
                        Use last group
                      </button>
                      {groups
                        .filter((group) => group.name !== 'Last group')
                        .map((group) => (
                          <button
                            type="button"
                            className="text-button"
                            key={group.name}
                            onClick={() => restoreGroup(group.name)}
                          >
                            Use {group.name}
                          </button>
                        ))}
                      <p className="helper">
                        Restores people only. Review and enter this occasion’s quantities.
                      </p>
                    </div>
                  ) : null}
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
                        disabled={linked}
                        onChange={(event) => patch({ groupTotal: Number(event.target.value) })}
                      />
                    </div>
                    {!linked ? (
                      <button
                        className="button button--outline"
                        type="button"
                        disabled={groupTotal < participants.length || groupTotal > 250}
                        onClick={() => {
                          const split = equalSplit(groupTotal, participants.length);
                          patch({
                            participants: participants.map((item, index) => ({
                              ...item,
                              amount: split[index] ?? 1,
                            })),
                          });
                        }}
                      >
                        Split equally
                      </button>
                    ) : null}
                  </div>
                  {groupTotal < participants.length && !linked ? (
                    <p className="group-help">
                      The total must be at least the number of people before it can be split
                      equally.
                    </p>
                  ) : null}
                  <fieldset className="participant-fieldset">
                    <legend>Participants</legend>
                    <div className="participant-list">
                      {participants.map((participant, index) => (
                        <div className="participant-row" key={participant.id}>
                          <MemberPicker
                            label={`Person ${index + 1}`}
                            inputId={`participant-${participant.id}`}
                            value={participant.contributor}
                            memberId={participant.memberId}
                            enabled={Boolean(capabilities?.enhancedLogging)}
                            disabled={linked}
                            token={capabilities?.memberCreation ? token : undefined}
                            inputRef={(element) => {
                              if (element) inputs.current.set(participant.id, element);
                              else inputs.current.delete(participant.id);
                            }}
                            onChange={(contributor, memberId) =>
                              updatePerson(participant.id, { contributor, memberId })
                            }
                          />
                          <div className="participant-row__amount">
                            <label htmlFor={`allocation-${participant.id}`}>
                              {linked ? 'Reverse' : 'Beers'}
                            </label>
                            <input
                              id={`allocation-${participant.id}`}
                              aria-label={`Beer allocation for participant ${index + 1}`}
                              type="number"
                              inputMode="numeric"
                              min={linked ? 0 : 1}
                              max={participant.maximum ?? 250}
                              step="1"
                              value={participant.amount}
                              onChange={(event) =>
                                updatePerson(participant.id, { amount: Number(event.target.value) })
                              }
                            />
                            {linked ? <small>Up to {participant.maximum}</small> : null}
                          </div>
                          {participants.length > 2 && !linked ? (
                            <button
                              className="participant-row__remove"
                              type="button"
                              aria-label={`Remove ${participant.contributor.trim() || `participant ${index + 1}`}`}
                              onClick={() => {
                                patch({
                                  participants: participants.filter(
                                    (item) => item.id !== participant.id,
                                  ),
                                });
                                const target = participants[index - 1]?.id;
                                window.setTimeout(
                                  () => target && inputs.current.get(target)?.focus(),
                                  0,
                                );
                              }}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {!linked ? (
                      <button
                        className="button button--quiet add-person"
                        type="button"
                        disabled={participants.length >= 25}
                        onClick={() => {
                          const next = person();
                          patch({ participants: [...participants, next] });
                          window.setTimeout(() => inputs.current.get(next.id)?.focus(), 0);
                        }}
                      >
                        Add person
                      </button>
                    ) : null}
                  </fieldset>
                  {!linked ? (
                    <>
                      <p
                        className={`allocation-status ${remaining === 0 ? 'allocation-status--exact' : 'allocation-status--mismatch'}`}
                        aria-live="polite"
                      >
                        <strong>{groupMessage}</strong>
                        <span>Allocations must match the total exactly.</span>
                      </p>
                      <button
                        className="text-button"
                        type="button"
                        disabled={participants.some((item) => !item.contributor.trim())}
                        onClick={() => {
                          const name = window.prompt(
                            'Name this participant group (stored only on this device):',
                          );
                          if (name?.trim()) {
                            const saved = saveGroup({
                              name: name.trim().slice(0, 40),
                              people: participants.map(({ contributor, memberId }) => ({
                                contributor,
                                memberId,
                              })),
                            });
                            setGroups(readGroups());
                            if (!saved) setError('This browser could not save the group.');
                          }
                        }}
                      >
                        Save these people as a group
                      </button>
                    </>
                  ) : null}
                </>
              )}
              <label htmlFor="entry-note">
                {correction
                  ? 'Correction reason'
                  : mode === 'group'
                    ? 'Shared note (optional)'
                    : 'Note (optional)'}
              </label>
              <textarea
                id="entry-note"
                maxLength={140}
                rows={2}
                value={note}
                placeholder={
                  correction ? 'Why is this being corrected?' : 'A small detail worth remembering'
                }
                onChange={(event) => patch({ note: event.target.value })}
              />
              <div className="form-meta">{note.length}/140</div>
              {!correction && (capabilities?.enhancedLogging || capabilities?.occurrence) ? (
                <details className="enrichment">
                  <summary>Add a memory or occurrence date</summary>
                  {capabilities?.enhancedLogging ? (
                    <div className="metadata-grid">
                      {(
                        [
                          ['title', 'Occasion title', 80],
                          ['venue', 'Venue', 80],
                          ['city', 'City', 80],
                          ['beer', 'Beer', 80],
                          ['brewery', 'Brewery', 80],
                        ] as const
                      ).map(([field, label, max]) => (
                        <div key={field}>
                          <label htmlFor={`memory-${field}`}>{label} (optional)</label>
                          <input
                            id={`memory-${field}`}
                            maxLength={max}
                            value={form.memory[field] ?? ''}
                            onChange={(event) =>
                              patch({ memory: { ...form.memory, [field]: event.target.value } })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {capabilities?.occurrence ? (
                    <>
                      <label htmlFor="occurred-date">Happened on (optional)</label>
                      <input
                        id="occurred-date"
                        type="date"
                        value={form.date}
                        onChange={(event) => patch({ date: event.target.value })}
                      />
                      <div className="metadata-grid">
                        <div>
                          <label htmlFor="occurred-time">Time (leave blank if unknown)</label>
                          <input
                            id="occurred-time"
                            type="time"
                            value={form.time}
                            disabled={!form.date}
                            onChange={(event) => patch({ time: event.target.value })}
                          />
                        </div>
                        <div>
                          <label htmlFor="occurred-zone">Occurrence timezone</label>
                          <input
                            id="occurred-zone"
                            value={form.timezone}
                            onChange={(event) => patch({ timezone: event.target.value })}
                          />
                        </div>
                      </div>
                      <p className="helper">
                        An earlier date is labeled as backdated. The server’s recording time is kept
                        separately. Leave the date blank when unknown.
                      </p>
                    </>
                  ) : null}
                </details>
              ) : null}
              {!linked ? (
                <label className="correction-toggle">
                  <input
                    type="checkbox"
                    checked={correction}
                    onChange={(event) => patch({ correction: event.target.checked })}
                  />
                  <span>
                    <strong>Correction mode</strong>
                    <small>
                      Creates a separate negative entry. History is never rewritten. Use History to
                      link a correction to its source.
                    </small>
                  </span>
                </label>
              ) : null}
              <p className="helper">
                Names, notes and occasion details you submit are public. The shared code gives
                editing access; it does not verify or claim a member identity.
              </p>
              {groupValidation && mode === 'group' && (remaining === 0 || linked) ? (
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
                disabled={submitting || (mode === 'group' && Boolean(groupValidation))}
              >
                {mode === 'single'
                  ? correction
                    ? `Review correction of -${amount}`
                    : `Record +${amount} beers`
                  : correction
                    ? 'Review group correction'
                    : 'Review group entry'}
              </button>
            </form>
          </>
        )}
        <p className="draft-notice">{storageNotice}</p>
        <div className="draft-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => downloadDraft(makeDraft(form, attempt))}
          >
            Download local draft
          </button>
          {!attempt ? (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (window.confirm('Discard this unsent draft from this browser?')) {
                  void discardEditableDraft().then((discarded) => {
                    if (!discarded) {
                      setError(
                        'Another tab has a saved or active submission. It cannot be discarded here. Resolve it first.',
                      );
                      return;
                    }
                    setForm(newForm(initialCorrection));
                    setReviewing(false);
                    setError(null);
                  });
                }
              }}
            >
              Discard draft
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
