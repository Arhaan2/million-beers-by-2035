import { useEffect, useId, useState } from 'react';
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
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recent] = useState(readRecentParticipants);
  useEffect(() => {
    if (!enabled || !expanded) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void fetchMembers(new URLSearchParams({ q: value, limit: '20' }).toString())
        .then((page) => {
          if (!cancelled) {
            setMembers(page.members);
            setCursor(page.nextCursor);
            setError('');
          }
        })
        .catch(() => {
          if (!cancelled) setError('Directory unavailable. Try the search again.');
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, expanded, value]);
  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await fetchMembers(
        new URLSearchParams({ q: value, cursor, limit: '20' }).toString(),
      );
      setMembers((current) => [...current, ...page.members]);
      setCursor(page.nextCursor);
    } catch {
      setError('Could not load more members.');
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!token || !value.trim()) return;
    setBusy(true);
    try {
      const { member } = await createMember(value.trim(), token);
      onChange(member.displayName, member.id);
      setExpanded(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Member could not be created.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="member-picker">
      <label htmlFor={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        value={value}
        disabled={disabled}
        maxLength={30}
        autoComplete="off"
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
            {memberId ? 'Member selected · change' : 'Find in the full crew directory'}
          </button>
          {expanded ? (
            <div className="member-picker__results" id={`${id}-directory`}>
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
                        onClick={() => {
                          onChange(member.contributor, member.memberId);
                          setExpanded(false);
                        }}
                      >
                        {member.contributor}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <ul>
                {members.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(member.displayName, member.id);
                        setExpanded(false);
                      }}
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
              {!busy && !members.length ? (
                <p className="helper">No matching public members.</p>
              ) : null}
              {cursor ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => void more()}
                >
                  More members
                </button>
              ) : null}
              {token && value.trim() && !memberId ? (
                <button
                  type="button"
                  disabled={busy}
                  className="button button--outline"
                  onClick={() => void create()}
                >
                  Create “{value.trim()}” as a member
                </button>
              ) : null}
              {busy ? (
                <p role="status" className="helper">
                  Searching crew…
                </p>
              ) : null}
              {error ? (
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
