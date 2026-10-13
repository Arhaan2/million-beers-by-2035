import { useEffect, useId, useRef, useState } from 'react';
import { createMember, fetchMembers } from '../lib/api';
import type { CrewMember } from '../lib/types';
import { readRecentParticipants } from '../lib/drafts';

export function MemberPicker({
  value,
  memberId,
  onChange,
  token,
  label,
  inputId,
  enabled,
  disabled,
  inputRef,
}: {
  value: string;
  memberId?: string | undefined;
  onChange: (name: string, id?: string) => void;
  token?: string | undefined;
  label: string;
  inputId?: string | undefined;
  enabled: boolean;
  disabled?: boolean;
  inputRef?: (element: HTMLInputElement | null) => void;
}) {
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<CrewMember[]>([]);
  const [resultQuery, setResultQuery] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [recent] = useState(readRecentParticipants);
  const nameInput = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const waitingForResults = enabled && expanded && resultQuery !== value;
  const pending = busy || creating || waitingForResults;
  const visibleMembers = resultQuery === value ? members : [];
  const select = (name: string, id?: string) => {
    onChange(name, id);
    setExpanded(false);
    setError('');
    nameInput.current?.focus();
  };
  useEffect(() => {
    if (!enabled || !expanded) return;
    let cancelled = false;
    requestVersion.current += 1;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void fetchMembers(new URLSearchParams({ q: value, limit: '20' }).toString())
        .then((page) => {
          if (!cancelled) {
            setMembers(page.members);
            setCursor(page.nextCursor);
            setResultQuery(value);
            setError('');
          }
        })
        .catch(() => {
          if (!cancelled) {
            setMembers([]);
            setCursor(null);
            setResultQuery(value);
            setError('Directory unavailable. Try the search again.');
          }
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      requestVersion.current += 1;
      window.clearTimeout(timer);
    };
  }, [enabled, expanded, value]);
  const more = async () => {
    if (!cursor || pending) return;
    const version = requestVersion.current;
    setBusy(true);
    try {
      const page = await fetchMembers(
        new URLSearchParams({ q: value, cursor, limit: '20' }).toString(),
      );
      if (version === requestVersion.current) {
        setMembers((current) => [...current, ...page.members]);
        setCursor(page.nextCursor);
        setError('');
      }
    } catch {
      if (version === requestVersion.current) setError('Could not load more members.');
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  };
  const create = async () => {
    if (!token || !value.trim() || pending) return;
    setCreating(true);
    try {
      const { member } = await createMember(value.trim(), token);
      select(member.displayName, member.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Member could not be created.');
    } finally {
      setCreating(false);
    }
  };
  return (
    <div
      className="member-picker"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.stopPropagation();
          event.preventDefault();
          setExpanded(false);
          nameInput.current?.focus();
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        ref={(element) => {
          nameInput.current = element;
          inputRef?.(element);
        }}
        id={id}
        value={value}
        disabled={disabled}
        readOnly={creating}
        maxLength={30}
        autoComplete="off"
        aria-controls={enabled && expanded ? `${id}-directory` : undefined}
        placeholder="Anonymous"
        onChange={(event) => {
          onChange(event.target.value);
          if (enabled) setExpanded(true);
        }}
      />
      {enabled && !disabled ? (
        <>
          <button
            type="button"
            className="text-button"
            aria-expanded={expanded}
            aria-controls={`${id}-directory`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? 'Close crew directory'
              : memberId
                ? 'Member selected · change'
                : 'Find in the full crew directory'}
          </button>
          {expanded ? (
            <div
              className="member-picker__results"
              id={`${id}-directory`}
              role="region"
              aria-label={`${label} crew directory`}
              aria-busy={pending}
            >
              <p className="helper">
                Search display names and aliases. These are member records, not verified accounts.
              </p>
              {!value && recent.length ? (
                <>
                  <p className="helper">Recent participants on this device</p>
                  <div className="recent-participants">
                    {recent.map((member) => (
                      <button
                        className="text-button"
                        type="button"
                        key={member.memberId}
                        onClick={() => select(member.contributor, member.memberId)}
                      >
                        {member.contributor}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <ul aria-label="Matching crew members">
                {visibleMembers.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      aria-label={`Select ${member.displayName}`}
                      onClick={() => select(member.displayName, member.id)}
                    >
                      <span className="avatar" aria-hidden="true">
                        {member.displayName.slice(0, 2)}
                      </span>
                      <span>{member.displayName}</span>
                      <small>Select</small>
                    </button>
                  </li>
                ))}
              </ul>
              {!pending && !visibleMembers.length && !error ? (
                <p className="helper" role="status">
                  No matching public members.
                </p>
              ) : null}
              {cursor && !waitingForResults ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={pending}
                  onClick={() => void more()}
                >
                  More members
                </button>
              ) : null}
              {token && value.trim() && !memberId ? (
                <button
                  type="button"
                  disabled={pending}
                  className="button button--outline"
                  onClick={() => void create()}
                >
                  Create “{value.trim()}” as a member
                </button>
              ) : null}
              {pending ? (
                <p role="status" className="helper">
                  {creating ? 'Creating member…' : 'Searching crew…'}
                </p>
              ) : null}
              {error && !waitingForResults ? (
                <p role="alert" className="form-error">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
