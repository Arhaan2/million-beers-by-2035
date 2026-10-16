import { useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError, createMember, fetchMembers } from '../lib/api';
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
  onLogin,
  onMutation,
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
  onLogin?: (() => void) | undefined;
  onMutation?: (() => void) | undefined;
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
  const creationInFlight = useRef(false);
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
    if (!value.trim() || pending || creationInFlight.current) return;
    if (!token) {
      onLogin?.();
      return;
    }
    creationInFlight.current = true;
    setCreating(true);
    setError('');
    const requestedName = value.trim().replace(/\s+/gu, ' ');
    let dispatched = false;
    const normalize = (name: string) => name.normalize('NFKC').toLocaleLowerCase('en-US');
    const findExisting = async (search?: string): Promise<CrewMember | undefined> => {
      let next: string | null = null;
      const seen = new Set<string>();
      let pages = 0;
      do {
        const query = new URLSearchParams(search ? { q: search, limit: '50' } : { limit: '50' });
        if (next) query.set('cursor', next);
        const page = await fetchMembers(query.toString());
        pages += 1;
        const matching = page.members.find((member) =>
          [member.displayName, ...member.aliases].some(
            (name) => normalize(name) === normalize(requestedName),
          ),
        );
        if (matching) return matching;
        next = page.nextCursor;
        if (next && seen.has(next))
          throw new Error('The directory changed. Check it again before creating this member.');
        if (next) seen.add(next);
        if (next && pages >= 50)
          throw new Error(
            'The directory is too large to check safely. Select the existing member from the directory.',
          );
      } while (next);
      return undefined;
    };
    // Public text search and normalized alias uniqueness have different Unicode
    // rules. A bounded directory fallback also finds fullwidth/case aliases.
    const reconcile = async (): Promise<CrewMember | undefined> =>
      (await findExisting(requestedName)) ?? (await findExisting());
    try {
      // Always reconcile first, including after closing/reopening a lost-response attempt.
      // The server's unique normalized alias constraint also protects concurrent creations.
      const existing = await reconcile();
      if (existing) {
        select(existing.displayName, existing.id);
        onMutation?.();
        return;
      }
      dispatched = true;
      const { member } = await createMember(requestedName, token);
      select(member.displayName, member.id);
      onMutation?.();
    } catch (caught) {
      if (!dispatched) {
        setError(
          'The directory could not be checked. No member was created. Your name is preserved; try again when connected.',
        );
      } else if (caught instanceof ApiRequestError && caught.status === 401) {
        setError(
          'Your name is preserved. Sign in again, then choose Create to check the directory and continue.',
        );
        onLogin?.();
      } else if (caught instanceof ApiRequestError && (caught.retryable || caught.status === 409)) {
        try {
          const existing = await reconcile();
          if (existing) {
            select(existing.displayName, existing.id);
            onMutation?.();
          } else {
            setError(
              'This member has not been confirmed in the directory. Your name is preserved. Choose Create again to recheck before another attempt.',
            );
          }
        } catch {
          setError(
            'Member creation could not be confirmed, and the directory is unavailable. Your name is preserved. Choose Create again when connected; the directory will be checked first.',
          );
        }
      } else setError(caught instanceof Error ? caught.message : 'Member could not be created.');
    } finally {
      creationInFlight.current = false;
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
              {(token || onLogin) && value.trim() && !memberId ? (
                <button
                  type="button"
                  disabled={pending}
                  className="button button--outline"
                  onClick={() => void create()}
                >
                  {token ? `Create “${value.trim()}” as a member` : 'Sign in to create this member'}
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
