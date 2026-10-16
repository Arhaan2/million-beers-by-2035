import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  fetchEntries,
  fetchOnThisDate,
  fetchMilestones,
  fetchEntry,
  fetchMember,
  fetchMembers,
  fetchRecap,
  updateMemory,
} from '../lib/api';
import { formatInteger, formatTimestamp } from '../lib/format';
import type {
  BeerEntry,
  Capabilities,
  DashboardSummary,
  EntryPage,
  MemberPage,
  MemoryMetadata,
  Recap,
} from '../lib/types';
import { ActivityFeed } from './ActivityFeed';
import { ShareActions } from './ShareActions';

function useResource<T>(loader: () => Promise<T>, key: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({
    key,
    data: null,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    void loader()
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null });
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setState({
            key,
            data: null,
            error: caught instanceof Error ? caught.message : 'Unable to load this page.',
          });
      });
    return () => {
      cancelled = true;
    };
    // The route key includes every query input; callers pass inline loaders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const retry = () => {
    setState({ key, data: null, error: null });
    setAttempt((value) => value + 1);
  };
  return { ...(state.key === key ? state : { data: null, error: null }), retry };
}
function PageStatus({
  error,
  onRetry,
  pageTitle = false,
}: {
  error: string | null;
  onRetry: () => void;
  pageTitle?: boolean;
}) {
  return (
    <div className="page-status" role={error ? 'alert' : 'status'} aria-atomic="true">
      <h2 id={pageTitle ? 'page-title' : undefined} tabIndex={pageTitle ? -1 : undefined}>
        {error ? 'This page could not be loaded' : 'Loading the shared ledger…'}
      </h2>
      <p>{error ?? 'Retrieving saved records.'}</p>
      {error ? (
        <button className="button button--outline" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  children,
  focusOnMount = false,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  focusOnMount?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focusOnMount || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const active = document.activeElement;
    if (
      !active ||
      active === document.body ||
      active.id === 'page-title' ||
      active.id === 'main-content'
    ) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [focusOnMount]);
  return (
    <div className="page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id="page-title" ref={heading} tabIndex={-1}>
        {title}
      </h2>
      {children}
    </div>
  );
}
export function CrewPage({ query }: { query: string }) {
  const search = new URLSearchParams(query);
  const [q, setQ] = useState(search.get('q') ?? '');
  const result = useResource(() => fetchMembers(query), query);
  const [extra, setExtra] = useState<MemberPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const page = extra ?? result.data;
  const more = async () => {
    if (busy || !page?.nextCursor) return;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams(query);
      params.set('cursor', page.nextCursor);
      const next = await fetchMembers(params.toString());
      setExtra({ members: [...page.members, ...next.members], nextCursor: next.nextCursor });
    } catch {
      setError('More members could not be loaded. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading eyebrow="A place for the whole crew" title="People behind the memories">
        <p>
          Browse every public member, including those beyond the leaderboard. A member is a stable
          display record, not a verified person or an account.
        </p>
      </PageHeading>
      <form
        className="search-bar"
        role="search"
        aria-label="Crew directory"
        onSubmit={(event) => {
          event.preventDefault();
          window.location.hash = `/crew?${new URLSearchParams({ q: q.trim() }).toString()}`;
        }}
      >
        <label htmlFor="crew-search">Find a display name or alias</label>
        <div>
          <input
            id="crew-search"
            type="search"
            value={q}
            maxLength={80}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search the full directory"
          />
          <button className="button button--primary">Search crew</button>
        </div>
        {search.get('q') ? (
          <a className="text-button" href="#/crew">
            Clear search
          </a>
        ) : null}
      </form>
      {page ? (
        <>
          <p className="helper" role="status" aria-atomic="true">
            {busy
              ? 'Loading more members…'
              : `${formatInteger(page.members.length)} public member${page.members.length === 1 ? '' : 's'} shown${page.nextCursor ? ' · More available' : ''}.`}
          </p>
          <div className="crew-grid">
            {page.members.map((member) => (
              <a
                className="crew-card"
                key={member.id}
                href={`#/member/${encodeURIComponent(member.id)}`}
              >
                <span className="avatar avatar--large" aria-hidden="true">
                  {member.displayName.slice(0, 2)}
                </span>
                <div>
                  <h3>{member.displayName}</h3>
                  <p>{formatInteger(member.participationCount)} positive entries participated in</p>
                  {member.aliases.length ? (
                    <small>Also listed as {member.aliases.join(', ')}</small>
                  ) : null}
                </div>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
          {!page.members.length ? (
            <p className="page-status">No public members match this search.</p>
          ) : null}
          {page.nextCursor ? (
            <button className="button button--outline" disabled={busy} onClick={() => void more()}>
              {busy ? 'Loading…' : 'Load more members'}
            </button>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <PageStatus error={result.error} onRetry={result.retry} />
      )}
    </>
  );
}
export function HistoryPage({ query, timezone }: { query: string; timezone: string }) {
  const params = new URLSearchParams(query);
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const invalidRange = Boolean(from && to && from > to);
  const result = useResource(() => fetchEntries(query), query);
  const [extra, setExtra] = useState<EntryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const page = extra ?? result.data;
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalidRange) return;
    const values = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const [name, value] of values)
      if (typeof value === 'string' && value) next.set(name, value);
    window.location.hash = `/history?${next.toString()}`;
  };
  const more = async () => {
    if (busy || !page?.nextCursor) return;
    setBusy(true);
    setError('');
    try {
      const nextParams = new URLSearchParams(query);
      nextParams.set('cursor', page.nextCursor);
      const next = await fetchEntries(nextParams.toString());
      setExtra({ entries: [...page.entries, ...next.entries], nextCursor: next.nextCursor });
    } catch {
      setError('More history could not be loaded. Your current results are preserved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading eyebrow="Every entry has a place" title="The shared history">
        <p>
          Search saved occasions and append-only allocations. Recording dates are always known;
          occurrence dates appear only when supplied.
        </p>
      </PageHeading>
      <form className="history-filters" onSubmit={search} role="search" aria-label="Shared history">
        <label>
          Occasion or note
          <input
            name="q"
            type="search"
            maxLength={80}
            defaultValue={params.get('q') ?? ''}
            placeholder="A title or detail"
          />
        </label>
        <label>
          From
          <input
            type="date"
            name="from"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-invalid={invalidRange || undefined}
            aria-describedby={invalidRange ? 'history-date-error' : undefined}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            name="to"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            aria-invalid={invalidRange || undefined}
            aria-describedby={invalidRange ? 'history-date-error' : undefined}
          />
        </label>
        <label>
          Date means
          <select name="dateBasis" defaultValue={params.get('dateBasis') ?? 'recorded'}>
            <option value="recorded">Recorded on</option>
            <option value="occurred">Happened on (known dates only)</option>
          </select>
        </label>
        <label>
          Venue
          <input name="venue" maxLength={80} defaultValue={params.get('venue') ?? ''} />
        </label>
        <label>
          Brewery
          <input name="brewery" maxLength={80} defaultValue={params.get('brewery') ?? ''} />
        </label>
        {params.get('community') === 'true' ? (
          <input type="hidden" name="community" value="true" />
        ) : null}
        {params.get('memberId') ? (
          <input type="hidden" name="memberId" value={params.get('memberId') ?? ''} />
        ) : null}
        <div className="button-row">
          <button className="button button--primary">Search history</button>
          <a href="#/history" className="button button--quiet">
            Clear filters
          </a>
        </div>
        {invalidRange ? (
          <p className="form-error" id="history-date-error" role="alert">
            Choose an end date on or after the start date.
          </p>
        ) : null}
      </form>
      {params.get('memberId') ? (
        <p className="notice">
          Filtered to one member.{' '}
          <a href={`#/member/${encodeURIComponent(params.get('memberId') ?? '')}`}>View member</a> ·{' '}
          <a href="#/history">Show everyone</a>
        </p>
      ) : null}
      {page ? (
        <>
          <p className="helper" role="status" aria-atomic="true">
            {busy
              ? 'Loading more records…'
              : `${formatInteger(page.entries.length)} matching record${page.entries.length === 1 ? '' : 's'} shown${page.nextCursor ? ' · More available' : ''}.`}
          </p>
          <ActivityFeed entries={page.entries} timezone={timezone} title="Matching records" />
          {page.nextCursor ? (
            <button
              className="button button--outline load-more"
              disabled={busy}
              onClick={() => void more()}
            >
              {busy ? 'Loading…' : 'Load more records'}
            </button>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <PageStatus error={result.error} onRetry={result.retry} />
      )}
    </>
  );
}
export function MemberPageView({ id, timezone }: { id: string; timezone: string }) {
  const result = useResource(() => fetchMember(id), id);
  if (!result.data) return <PageStatus error={result.error} onRetry={result.retry} pageTitle />;
  const { member, history } = result.data;
  return (
    <>
      <PageHeading eyebrow="Crew member record" title={member.displayName} focusOnMount>
        <p>This display record is not an authenticated or verified personal account.</p>
      </PageHeading>
      <div className="metric-strip">
        <div>
          <strong>{formatInteger(member.participationCount)}</strong>
          <span>Positive entries participated in</span>
        </div>
        <div>
          <strong>{formatInteger(member.allocationCount)}</strong>
          <span>Allocations, including corrections</span>
        </div>
        <div>
          <strong>{formatInteger(member.netTotal)}</strong>
          <span>Net recorded amount</span>
        </div>
      </div>
      {member.aliases.length ? (
        <p className="helper">Display aliases: {member.aliases.join(', ')}</p>
      ) : null}
      <ActivityFeed entries={history.entries} timezone={timezone} title="Member history" />
      <a
        className="button button--outline load-more"
        href={`#/history?memberId=${encodeURIComponent(member.id)}`}
      >
        Search this member’s full history
      </a>
    </>
  );
}
function MemoryEditor({
  entry,
  token,
  onSaved,
}: {
  entry: BeerEntry;
  token: string;
  onSaved: (entry: BeerEntry) => void;
}) {
  const [memory, setMemory] = useState<MemoryMetadata>(entry.memory ?? {});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateMemory(
        entry.id,
        { ...memory, visibility: 'public' },
        entry.metadataVersion ?? 0,
        token,
      );
      onSaved(result.entry);
      setMessage({
        text: 'Memory saved. Quantities and recording time are unchanged.',
        error: false,
      });
    } catch (caught) {
      setMessage({
        text: caught instanceof Error ? caught.message : 'Memory could not be saved.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="memory-editor">
      <summary>Edit public memory details</summary>
      <p className="helper">
        The shared crew code authorizes metadata edits. Changes are audited, and never resubmit
        quantities. Private metadata cannot be retrieved or changed here. Visibility changes require
        the independently authorized project operator.
      </p>
      <form
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="metadata-grid">
          {(['title', 'shortNote', 'venue', 'city', 'beer', 'brewery'] as const).map((field) => (
            <label key={field}>
              {field === 'shortNote'
                ? 'Short note'
                : field.charAt(0).toUpperCase() + field.slice(1)}
              <input
                name={field}
                maxLength={field === 'shortNote' ? 140 : 80}
                value={memory[field] ?? ''}
                readOnly={busy}
                onChange={(event) => {
                  setMemory({ ...memory, [field]: event.target.value });
                  setMessage(null);
                }}
              />
            </label>
          ))}
        </div>
        <button className="button button--outline" disabled={busy}>
          {busy ? 'Saving…' : 'Save memory details'}
        </button>
      </form>
      <p
        className={message?.error ? 'form-error' : 'helper'}
        role={message?.error ? 'alert' : 'status'}
        aria-atomic="true"
      >
        {busy ? 'Saving memory details…' : message?.text}
      </p>
    </details>
  );
}
export function EntryDetail({
  id,
  timezone,
  capabilities,
  token,
  onCorrect,
}: {
  id: string;
  timezone: string;
  capabilities?: Capabilities | undefined;
  token?: string | undefined;
  onCorrect: (entry: BeerEntry) => void;
}) {
  const result = useResource(() => fetchEntry(id), id);
  const [edited, setEdited] = useState<BeerEntry | null>(null);
  if (!result.data) return <PageStatus error={result.error} onRetry={result.retry} pageTitle />;
  const entry = edited ?? result.data.entry;
  const { corrections } = result.data;
  const memory = entry.memory;
  const occurrence = entry.occurredAt ? new Date(entry.occurredAt) : null;
  const occurredLabel = occurrence
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: entry.occurrenceTimezone ?? timezone,
        dateStyle: 'long',
        ...(entry.occurrencePrecision === 'minute' ? { timeStyle: 'short' as const } : {}),
      }).format(occurrence)
    : null;
  const backdated = occurrence
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: entry.occurrenceTimezone ?? timezone }).format(
        occurrence,
      ) !==
      new Intl.DateTimeFormat('sv-SE', { timeZone: entry.occurrenceTimezone ?? timezone }).format(
        entry.createdAt,
      )
    : false;
  return (
    <>
      <PageHeading
        focusOnMount
        eyebrow={entry.isCorrection ? 'Append-only correction' : 'A saved record'}
        title={
          memory?.title ?? (entry.isGroup ? 'An occasion with the crew' : 'A moment in the ledger')
        }
      >
        <p>
          {entry.isCorrection
            ? `${entry.correctionKind === 'linked' ? 'Linked correction' : 'Legacy unlinked adjustment'} · `
            : ''}
          Recorded on {formatTimestamp(entry.createdAt, timezone)}
        </p>
      </PageHeading>
      <div className="entry-detail-grid">
        <section className="panel">
          <div className="detail-total">
            <strong>
              {entry.totalAmount > 0 ? '+' : ''}
              {formatInteger(entry.totalAmount)}
            </strong>
            <span>Recorded amount</span>
          </div>
          {entry.correctionOfEntryId ? (
            <p>
              <a href={`#/entry/${encodeURIComponent(entry.correctionOfEntryId)}`}>
                View the original entry →
              </a>
            </p>
          ) : null}
          <h3>Participants & exact allocations</h3>
          <ul className="entry-review__allocations">
            {entry.allocations.map((allocation) => (
              <li key={allocation.id}>
                <span>
                  {allocation.memberId ? (
                    <a href={`#/member/${encodeURIComponent(allocation.memberId)}`}>
                      {allocation.contributor}
                    </a>
                  ) : (
                    allocation.contributor
                  )}
                </span>
                <strong>
                  {allocation.amount > 0 ? '+' : ''}
                  {allocation.amount}
                </strong>
              </li>
            ))}
          </ul>
          {entry.note ? <p className="entry-detail-note">{entry.note}</p> : null}
          {memory?.shortNote ? <p>{memory.shortNote}</p> : null}
          {capabilities?.linkedCorrections &&
          !entry.isCorrection &&
          entry.allocations.some((allocation) => (allocation.remainingCorrectable ?? 0) > 0) ? (
            <button className="button button--outline load-more" onClick={() => onCorrect(entry)}>
              Correct this entry
            </button>
          ) : null}
        </section>
        <section className="panel detail-memory">
          <p className="eyebrow">The details we kept</p>
          <h3>{occurredLabel ? 'Happened on' : 'Occurrence unknown'}</h3>
          <p>
            {occurredLabel ??
              'The original recording timestamp is available, but the occasion date was not separately supplied.'}
          </p>
          {occurredLabel ? (
            <p className="helper">
              {entry.occurrenceTimezone} ·{' '}
              {entry.occurrencePrecision === 'day' ? 'Date only; time unknown' : 'Time supplied'}
              {backdated ? ' · Backdated entry' : ''}
            </p>
          ) : null}
          <dl>
            {memory?.venue ? (
              <>
                <dt>Venue</dt>
                <dd>{memory.venue}</dd>
              </>
            ) : null}
            {memory?.city ? (
              <>
                <dt>City</dt>
                <dd>{memory.city}</dd>
              </>
            ) : null}
            {memory?.beer ? (
              <>
                <dt>Beer</dt>
                <dd>{memory.beer}</dd>
              </>
            ) : null}
            {memory?.brewery ? (
              <>
                <dt>Brewery</dt>
                <dd>{memory.brewery}</dd>
              </>
            ) : null}
          </dl>
          {!memory ? <p className="helper">No public memory details attached.</p> : null}
        </section>
      </div>
      {token && capabilities?.metadataEditing ? (
        <MemoryEditor entry={entry} token={token} onSaved={setEdited} />
      ) : null}
      <ShareActions
        data={{
          title: memory?.title ?? 'A moment with the crew',
          subtitle: occurredLabel
            ? `Happened on ${occurredLabel}`
            : `Recorded on ${formatTimestamp(entry.createdAt, timezone)}`,
          lines: [
            `${entry.allocations.length} participant allocation${entry.allocations.length === 1 ? '' : 's'} · ${entry.totalAmount > 0 ? '+' : ''}${entry.totalAmount} recorded`,
            [memory?.venue, memory?.city].filter(Boolean).join(' · '),
          ].filter(Boolean),
          names: entry.allocations.map((allocation) => allocation.contributor),
          url: window.location.href,
        }}
      />
      {corrections.length ? (
        <ActivityFeed entries={corrections} timezone={timezone} title="Linked corrections" />
      ) : null}
      <a href="#/history" className="text-button">
        ← Back to history
      </a>
    </>
  );
}
export function RecapsPage({ query, timezone }: { query: string; timezone: string }) {
  const [now] = useState(Date.now);
  const current = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).format(now);
  const period = new URLSearchParams(query).get('period') ?? current;
  const result = useResource(() => fetchRecap(period), period);
  const [input, setInput] = useState(period);
  const [periodTouched, setPeriodTouched] = useState(false);
  const validPeriod = /^[0-9]{4}(-(0[1-9]|1[0-2]))?$/u.test(input);
  const recap = result.data;
  return (
    <>
      <PageHeading eyebrow="Looking back, together" title="Recaps">
        <p>
          Monthly and yearly summaries link to their saved records. These use recording dates; they
          do not claim when a gathering happened.
        </p>
      </PageHeading>
      <form
        className="search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          setPeriodTouched(true);
          if (!validPeriod) return;
          window.location.hash = `/recaps?period=${encodeURIComponent(input)}`;
        }}
      >
        <label htmlFor="recap-period">Month (YYYY-MM) or year (YYYY)</label>
        <div>
          <input
            id="recap-period"
            name="period"
            pattern="[0-9]{4}(-(0[1-9]|1[0-2]))?"
            placeholder="2026-10"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onBlur={() => setPeriodTouched(true)}
            aria-describedby={
              periodTouched && !validPeriod ? 'recap-period-error' : 'recap-period-hint'
            }
            aria-invalid={(periodTouched && !validPeriod) || undefined}
            maxLength={7}
            required
          />
          <button className="button button--primary">View recap</button>
        </div>
        {periodTouched && !validPeriod ? (
          <p className="form-error" id="recap-period-error" role="alert">
            Enter a year such as 2026, or a month such as 2026-10.
          </p>
        ) : (
          <p className="helper" id="recap-period-hint">
            Enter a year for an annual recap, or add a month for a closer look.
          </p>
        )}
      </form>
      {recap ? (
        <RecapContent recap={recap} timezone={timezone} />
      ) : (
        <PageStatus error={result.error} onRetry={result.retry} />
      )}
    </>
  );
}
function OnThisDate({ timezone }: { timezone: string }) {
  const result = useResource(() => fetchOnThisDate(), 'on-this-date');
  const [extra, setExtra] = useState<
    (EntryPage & { dateBasis: 'occurred'; monthDay: string }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const page = extra ?? result.data;
  const more = async () => {
    if (busy || !page?.nextCursor) return;
    setBusy(true);
    setError('');
    try {
      const next = await fetchOnThisDate(
        new URLSearchParams({ monthDay: page.monthDay, cursor: page.nextCursor }).toString(),
      );
      setExtra({ ...next, entries: [...page.entries, ...next.entries] });
    } catch {
      setError('More memories could not be loaded. Try again.');
    } finally {
      setBusy(false);
    }
  };
  if (!page)
    return result.error ? (
      <div className="notice">
        <p role="alert">On-this-date memories are temporarily unavailable.</p>
        <button className="button button--quiet" onClick={result.retry}>
          Try loading memories again
        </button>
      </div>
    ) : (
      <p className="helper" role="status">
        Loading on-this-date memories…
      </p>
    );
  return (
    <section className="on-this-date">
      <div className="section-heading">
        <div>
          <p className="eyebrow">A date worth remembering · {page.monthDay}</p>
          <h2>On this date</h2>
        </div>
      </div>
      <p className="helper">
        Only independently supplied occurrence dates are included. Unknown historical dates are
        never inferred from recording time.
      </p>
      <p className="helper" role="status" aria-atomic="true">
        {busy
          ? 'Loading more memories…'
          : `${formatInteger(page.entries.length)} memor${page.entries.length === 1 ? 'y' : 'ies'} shown${page.nextCursor ? ' · More available' : ''}.`}
      </p>
      {page.entries.length ? (
        <ActivityFeed
          entries={page.entries}
          timezone={timezone}
          title="Known occasions on this date"
        />
      ) : (
        <p className="notice">
          No public occasions with a known occurrence date match this date yet.
        </p>
      )}
      {page.nextCursor ? (
        <button
          className="button button--outline load-more"
          disabled={busy}
          onClick={() => void more()}
        >
          {busy ? 'Loading…' : 'Load more memories'}
        </button>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
function RecapContent({ recap, timezone }: { recap: Recap; timezone: string }) {
  const from = recap.period.length === 4 ? `${recap.period}-01-01` : `${recap.period}-01`;
  const end = new Date(`${from}T12:00:00Z`);
  if (recap.period.length === 4) end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  const query = new URLSearchParams({
    from,
    to: end.toISOString().slice(0, 10),
    dateBasis: 'recorded',
    community: 'true',
  });
  return (
    <>
      <div className="recap-hero panel">
        <p className="eyebrow">Recorded in {recap.period}</p>
        <h3>A chapter in the shared ledger.</h3>
        <div className="metric-strip">
          <div>
            <strong>{formatInteger(recap.entryCount)}</strong>
            <span>Community entries</span>
          </div>
          <div>
            <strong>{formatInteger(recap.participantCount)}</strong>
            <span>Named participants</span>
          </div>
          <div>
            <strong>{formatInteger(recap.netTotal)}</strong>
            <span>Net community amount</span>
          </div>
        </div>
        <a className="button button--outline" href={`#/history?${query.toString()}`}>
          Explore contributing records →
        </a>
      </div>
      <ShareActions
        data={{
          title: `The ${recap.period} recap`,
          subtitle: 'Community activity · by recording date',
          lines: [
            `${recap.entryCount} entries · ${recap.participantCount} named participants`,
            `${recap.netTotal} net recorded`,
          ],
          url: window.location.href,
        }}
      />
      <ActivityFeed entries={recap.entries} timezone={timezone} title="Records in this recap" />
      <OnThisDate timezone={timezone} />
    </>
  );
}
export function AboutPage({ summary }: { summary: DashboardSummary | null }) {
  return (
    <>
      <PageHeading
        eyebrow="One crew. A shared record."
        title="An impossible number. Real time together."
      >
        <p>
          The Million Beer Project is a collective record of moments along the way to 2035. The
          counter holds the quantities; the crew, occasions and notes keep the context.
        </p>
      </PageHeading>
      <div className="about-grid">
        <section className="panel prose">
          <h3>What this project measures</h3>
          <p>
            The canonical counter includes every allocation and correction, including operational
            records preserved for audit. Community participation and recap metrics exclude only
            server-classified operational records with verified provenance.
          </p>
          <dl>
            <dt>Directory size</dt>
            <dd>Stable member records, not a count of verified people.</dd>
            <dt>Named contributors</dt>
            <dd>Named community members with a positive allocation.</dd>
            <dt>Active participants</dt>
            <dd>Named participants active within the server-defined recent window.</dd>
            <dt>Community entries</dt>
            <dd>
              Community quantity submissions. A group submission is not a separately verified
              gathering.
            </dd>
          </dl>
          {summary?.community ? (
            <p>
              Current directory: {summary.community.directorySize} records. Named contributors:{' '}
              {summary.community.namedContributors}. Recent active participants:{' '}
              {summary.community.activeParticipants}.
            </p>
          ) : null}
        </section>
        <section className="panel prose">
          <h3>Public by design, honest about access</h3>
          <p>
            The public ledger shows display names, allocations, dates and approved public memory
            details. Names are labels, not verified identities. The shared crew code grants editing
            rights and does not establish ownership of a member record.
          </p>
          <p>
            Display preferences and alias administration require an independently authorized
            operator. Previously public copies and screenshots cannot be recalled. No public photo
            upload or individual invitation system is enabled in this release.
          </p>
          <h3>Partners & the community story</h3>
          <p>
            This page uses real project records. No sponsors, testimonials, audience reach or
            demographic claims are implied.
          </p>
          <p>
            For partnerships or questions, <a href="#/partners">Explore project partnerships</a> or
            contact <a href="mailto:arhaanaggarwal@gmail.com">arhaanaggarwal@gmail.com</a>.
          </p>
          <a
            href="https://github.com/Arhaan2/million-beers-by-2035"
            target="_blank"
            rel="noreferrer"
          >
            Read the project source →
          </a>
        </section>
      </div>
    </>
  );
}

export function MilestoneHistory({ revision }: { revision: number }) {
  const result = useResource(fetchMilestones, String(revision));
  return (
    <section className="panel">
      <h3>Milestone history</h3>
      <p className="helper">
        First recorded day ending at or above each collective milestone. Daily closing totals
        include all ledger allocations. Intraday crossing times are unknown.
      </p>
      {result.data ? (
        result.data.milestones.length ? (
          <ol className="milestone-list">
            {result.data.milestones.map((milestone) => (
              <li key={milestone.amount}>
                <strong>{formatInteger(milestone.amount)}</strong>
                <a href={`#/history?to=${encodeURIComponent(milestone.recordedDay)}`}>
                  {milestone.recordedDay}
                </a>
                <small>Day closed at {formatInteger(milestone.closingTotal)}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="helper">No recorded day has closed at the first milestone yet.</p>
        )
      ) : (
        <>
          <p className="helper" role={result.error ? 'alert' : 'status'}>
            {result.error
              ? 'Milestone history could not be loaded.'
              : 'Loading recorded milestones…'}
          </p>
          {result.error ? (
            <button className="button button--quiet" onClick={result.retry}>
              Try loading milestones again
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
