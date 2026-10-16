import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  fetchEntries,
  fetchOnThisDate,
  fetchMilestones,
  fetchEntry,
  fetchMember,
  fetchMembers,
  fetchRecap,
} from '../lib/api';
import { formatInteger, formatTimestamp } from '../lib/format';
import type { BeerEntry, Capabilities, DashboardSummary, EntryPage, Recap } from '../lib/types';
import { ActivityFeed } from './ActivityFeed';
import { ShareActions } from './ShareActions';
import { MemoryEditor } from './MemoryEditor';
import { ArchiveExport } from './ArchiveExport';
import {
  useCommunityResource as useResource,
  useCommunityPages,
} from '../hooks/useCommunityResource';
import { periodLabel, adjacentPeriod, periodRange, validPeriod } from '../lib/recaps';

type RecordPeople = (participants: { memberId: string; displayName: string }[]) => void;
function withCursor(query: string, cursor?: string) {
  if (!cursor) return query;
  const params = new URLSearchParams(query);
  params.set('cursor', cursor);
  return params.toString();
}
function mergeEntries<T extends EntryPage>(previous: T, next: T): T {
  return {
    ...next,
    entries: [
      ...new Map([...previous.entries, ...next.entries].map((entry) => [entry.id, entry])).values(),
    ],
  };
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
export function CrewPage({
  query,
  resourceRevision = 0,
}: {
  query: string;
  resourceRevision?: number;
}) {
  const search = new URLSearchParams(query);
  const [q, setQ] = useState(search.get('q') ?? '');
  const { page, busy, error, more, retry } = useCommunityPages(
    (cursor) => fetchMembers(withCursor(query, cursor)),
    (previous, next) => ({
      ...next,
      members: [
        ...new Map(
          [...previous.members, ...next.members].map((member) => [member.id, member]),
        ).values(),
      ],
    }),
    query,
    resourceRevision,
    'More members could not be loaded. Try again.',
  );
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
        <PageStatus error={error || null} onRetry={retry} />
      )}
    </>
  );
}
export function HistoryPage({
  query,
  timezone,
  resourceRevision = 0,
}: {
  query: string;
  timezone: string;
  resourceRevision?: number;
}) {
  const params = new URLSearchParams(query);
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const invalidRange = Boolean(from && to && from > to);
  const { page, busy, error, more, retry } = useCommunityPages(
    (cursor) => fetchEntries(withCursor(query, cursor)),
    mergeEntries,
    query,
    resourceRevision,
    'More history could not be loaded. Your current results are preserved.',
  );
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalidRange) return;
    const values = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const [name, value] of values)
      if (typeof value === 'string' && value) next.set(name, value);
    window.location.hash = `/history?${next.toString()}`;
  };
  return (
    <>
      <PageHeading eyebrow="Every entry has a place" title="The shared history">
        <p>
          Search saved entries, public memories and their allocations. Recording dates are always
          known; occurrence dates appear only when supplied.
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
        <label>
          City
          <input name="city" maxLength={80} defaultValue={params.get('city') ?? ''} />
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
      <ArchiveExport query={query} resourceRevision={resourceRevision} />
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
        <PageStatus error={error || null} onRetry={retry} />
      )}
    </>
  );
}
export function MemberPageView({
  id,
  timezone,
  resourceRevision = 0,
  onRecord,
}: {
  id: string;
  timezone: string;
  resourceRevision?: number;
  onRecord?: RecordPeople;
}) {
  const result = useResource(() => fetchMember(id), id, resourceRevision);
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
      {onRecord ? (
        <button
          className="button button--primary"
          onClick={() => onRecord([{ memberId: member.id, displayName: member.displayName }])}
        >
          Record for this member
        </button>
      ) : null}
      {result.error ? (
        <p role="alert" className="form-error">
          {result.error}{' '}
          <button className="text-button" onClick={result.retry}>
            Refresh member
          </button>
        </p>
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
export function EntryDetail({
  id,
  timezone,
  capabilities,
  token,
  onCorrect,
  resourceRevision = 0,
  onMutation,
  onLogin,
  onRecord,
  editMemory = false,
}: {
  id: string;
  timezone: string;
  capabilities?: Capabilities | undefined;
  token?: string | undefined;
  onCorrect: (entry: BeerEntry) => void;
  resourceRevision?: number;
  onMutation?: () => void;
  onLogin?: () => void;
  onRecord?: RecordPeople;
  editMemory?: boolean;
}) {
  const result = useResource(() => fetchEntry(id), id, resourceRevision);
  const [edited, setEdited] = useState<{
    id: string;
    source: Awaited<ReturnType<typeof fetchEntry>> | null;
    data: Awaited<ReturnType<typeof fetchEntry>>;
  } | null>(null);
  // A newer direct read supersedes the current resource even if privacy changed without a
  // metadata version increment. The next resource response then replaces this override.
  const details =
    edited && edited.id === id && edited.source === result.data ? edited.data : result.data;
  const entry = details?.entry ?? null;
  const editor = capabilities?.metadataEditing ? (
    <MemoryEditor
      key={id}
      entry={
        entry ?? {
          id,
          totalAmount: 0,
          createdAt: 0,
          localDay: '',
          isCorrection: false,
          isGroup: false,
          allocations: [],
          note: null,
          memory: null,
        }
      }
      token={token}
      initiallyOpen={editMemory}
      available={Boolean(entry)}
      resourceRevision={resourceRevision}
      onLogin={onLogin ?? (() => undefined)}
      onRefreshed={(fresh) => {
        setEdited({ id, source: result.data, data: fresh });
        result.retry();
        onMutation?.();
      }}
      onSaved={(saved) => {
        setEdited({
          id,
          source: result.data,
          data: { entry: saved, corrections: details?.corrections ?? [] },
        });
        result.retry();
        onMutation?.();
      }}
    />
  ) : null;
  if (!entry || !details)
    return (
      <>
        <PageStatus error={result.error} onRetry={result.retry} pageTitle />
        {editor}
      </>
    );
  const { corrections } = details;
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
          {onRecord &&
          !entry.isCorrection &&
          !entry.isSystem &&
          entry.allocations.length > 0 &&
          entry.allocations.every((allocation) => allocation.memberId) ? (
            <button
              className="button button--primary load-more"
              onClick={() =>
                onRecord(
                  entry.allocations.map((allocation) => ({
                    memberId: allocation.memberId!,
                    displayName: allocation.contributor,
                  })),
                )
              }
            >
              Use these people
            </button>
          ) : null}
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
                <dd>
                  <a href={`#/history?venue=${encodeURIComponent(memory.venue)}`}>{memory.venue}</a>
                </dd>
              </>
            ) : null}
            {memory?.city ? (
              <>
                <dt>City</dt>
                <dd>
                  <a href={`#/history?city=${encodeURIComponent(memory.city)}`}>{memory.city}</a>
                </dd>
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
                <dd>
                  <a href={`#/history?brewery=${encodeURIComponent(memory.brewery)}`}>
                    {memory.brewery}
                  </a>
                </dd>
              </>
            ) : null}
          </dl>
          {!memory ? <p className="helper">No public memory details attached.</p> : null}
        </section>
      </div>
      {result.error ? (
        <p role="alert" className="form-error">
          {result.error}{' '}
          <button className="text-button" onClick={result.retry}>
            Refresh entry
          </button>
        </p>
      ) : null}
      {editor}
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
export function RecapsPage({
  query,
  timezone,
  resourceRevision = 0,
}: {
  query: string;
  timezone: string;
  resourceRevision?: number;
}) {
  const [now] = useState(Date.now);
  const current = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).format(now);
  const requested = new URLSearchParams(query).get('period') ?? current;
  const valid = validPeriod(requested);
  const period = valid ? requested : current;
  const result = useResource(
    () =>
      valid
        ? fetchRecap(period, query)
        : Promise.reject(
            new Error(
              'Choose a valid month or year below. The link contains an invalid recap period.',
            ),
          ),
    query,
    resourceRevision,
  );
  const recap = result.data;
  const years = [
    ...new Set([
      current.slice(0, 4),
      period.slice(0, 4),
      ...(recap?.availableMonths ?? []).map((month) => month.slice(0, 4)),
    ]),
  ]
    .sort()
    .reverse();
  const navigate = (next: string) => {
    const params = new URLSearchParams(query);
    params.set('period', next);
    params.delete('cursor');
    window.location.hash = `/recaps?${params.toString()}`;
  };
  const previous = adjacentPeriod(period, -1);
  const next = adjacentPeriod(period, 1);
  return (
    <>
      <PageHeading eyebrow="Looking back, together" title="Recaps">
        <p>
          Monthly and yearly summaries use recording dates in {timezone}. They do not claim when an
          occasion happened.
        </p>
      </PageHeading>
      <div className="recap-controls panel" role="group" aria-label="Choose recap period">
        <label>
          Year
          <select
            aria-label="Recap year"
            value={period.slice(0, 4)}
            onChange={(event) =>
              navigate(event.target.value + (period.length === 7 ? period.slice(4) : ''))
            }
          >
            {years.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        </label>
        <label>
          Month
          <select
            aria-label="Recap month"
            value={period.slice(5) || 'all'}
            onChange={(event) =>
              navigate(
                period.slice(0, 4) + (event.target.value === 'all' ? '' : `-${event.target.value}`),
              )
            }
          >
            <option value="all">Whole year</option>
            {Array.from({ length: 12 }, (_, index) => {
              const month = String(index + 1).padStart(2, '0');
              return (
                <option key={month} value={month}>
                  {new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
                    new Date(`2000-${month}-01T12:00:00Z`),
                  )}
                </option>
              );
            })}
          </select>
        </label>
        <div className="button-row">
          <button
            className="button button--outline"
            disabled={!previous}
            onClick={() => previous && navigate(previous)}
          >
            ← Previous {period.length === 4 ? 'year' : 'month'}
          </button>
          <button
            className="button button--outline"
            disabled={!next}
            onClick={() => next && navigate(next)}
          >
            Next {period.length === 4 ? 'year' : 'month'} →
          </button>
        </div>
        {!valid ? (
          <button className="text-button" onClick={() => navigate(current)}>
            Open the current month
          </button>
        ) : null}
      </div>
      {recap?.availableMonths?.length ? (
        <nav className="archive-months" aria-label="Months with saved records">
          <label>
            Jump to a recorded month
            <select
              aria-label="Jump to a recorded month"
              value={recap.availableMonths.includes(period) ? period : ''}
              onChange={(event) => {
                if (event.target.value) navigate(event.target.value);
              }}
            >
              <option value="" disabled>
                Choose a month with records
              </option>
              {recap.availableMonths.map((month) => (
                <option key={month} value={month}>
                  {periodLabel(month)}
                </option>
              ))}
            </select>
          </label>
          <p className="helper">
            {recap.availableMonths.length} months with matching community records.
          </p>
        </nav>
      ) : recap?.availableMonths ? (
        <p className="notice">No recorded months match these filters yet.</p>
      ) : null}
      {recap ? (
        <>
          <RecapContent
            recap={recap}
            timezone={timezone}
            query={query}
            resourceRevision={resourceRevision}
          />
          {result.error ? (
            <p role="alert">
              {result.error}{' '}
              <button className="text-button" onClick={result.retry}>
                Refresh recap
              </button>
            </p>
          ) : null}
        </>
      ) : (
        <PageStatus error={result.error} onRetry={result.retry} />
      )}
    </>
  );
}
function OnThisDate({
  timezone,
  resourceRevision,
}: {
  timezone: string;
  resourceRevision: number;
}) {
  const [now] = useState(Date.now);
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const monthDay = `${dateParts.find((part) => part.type === 'month')?.value}-${dateParts.find((part) => part.type === 'day')?.value}`;
  const dateQuery = new URLSearchParams({ monthDay }).toString();
  const { page, busy, error, more, retry } = useCommunityPages(
    (cursor) => fetchOnThisDate(withCursor(dateQuery, cursor)),
    mergeEntries,
    `on-this-date:${monthDay}`,
    resourceRevision,
    'More memories could not be loaded. Try again.',
  );
  if (!page)
    return error ? (
      <div className="notice">
        <p role="alert">On-this-date memories are temporarily unavailable.</p>
        <button className="button button--quiet" onClick={retry}>
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
function RecapContent({
  recap,
  timezone,
  query: selectedQuery,
  resourceRevision,
}: {
  recap: Recap;
  timezone: string;
  query: string;
  resourceRevision: number;
}) {
  const range = periodRange(recap.period);
  const query = new URLSearchParams(selectedQuery);
  query.delete('period');
  query.delete('cursor');
  query.set('from', range.from);
  query.set('to', range.to);
  query.set('dateBasis', 'recorded');
  query.set('community', 'true');
  return (
    <>
      <div className="recap-hero panel">
        <p className="eyebrow">Recorded in {periodLabel(recap.period)}</p>
        <h3>A chapter in the shared ledger.</h3>
        <div className="metric-strip">
          <div>
            <strong>{formatInteger(recap.entryCount)}</strong>
            <span>Community entries</span>
          </div>
          <div>
            <strong>{formatInteger(recap.participantCount)}</strong>
            <span>Participating named member records</span>
          </div>
          <div>
            <strong>{formatInteger(recap.netTotal)}</strong>
            <span>Net community amount</span>
          </div>
        </div>
        {typeof recap.publicPlaceCount === 'number' ? (
          <p className="helper">
            {formatInteger(recap.publicPlaceCount)} public venue/city combinations ·{' '}
            {formatInteger(recap.cityCount ?? 0)} cities · {formatInteger(recap.breweryCount ?? 0)}{' '}
            breweries represented in the complete selection.
          </p>
        ) : null}
        <p className="helper">
          Entries are saved submissions, not verified distinct gatherings. Named member records are
          not verified people. Corrections are included in the net amount.
        </p>
        {!recap.entryCount ? (
          <p className="notice">
            No community entries match this period and these filters. Choose another month or clear
            the history filters.
          </p>
        ) : null}
        <a className="button button--outline" href={`#/history?${query.toString()}`}>
          Explore contributing records →
        </a>
      </div>
      <ShareActions
        data={{
          title: `The ${periodLabel(recap.period)} recap`,
          subtitle: 'Community activity · by recording date',
          lines: [
            `${recap.entryCount} entries · ${recap.participantCount} named member records`,
            `${recap.netTotal} net recorded`,
          ],
          url: window.location.href,
        }}
      />
      <ActivityFeed entries={recap.entries} timezone={timezone} title="Records in this recap" />
      <ArchiveExport query={query.toString()} resourceRevision={resourceRevision} />
      <OnThisDate timezone={timezone} resourceRevision={resourceRevision} />
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
            <a href="#/partners">Explore possible collaborations →</a>
          </p>
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
                <details className="milestone-share">
                  <summary>Share this recorded milestone</summary>
                  <ShareActions
                    data={{
                      title: `${formatInteger(milestone.amount)} recorded`,
                      subtitle: `Recorded-day milestone · ${milestone.recordedDay}`,
                      lines: [
                        `First day closing at or above ${formatInteger(milestone.amount)}`,
                        `Day closed at ${formatInteger(milestone.closingTotal)} · includes corrections`,
                        'Intraday crossing time is unknown.',
                      ],
                      url: new URL(
                        `#/history?${new URLSearchParams({ from: milestone.recordedDay, to: milestone.recordedDay, dateBasis: 'recorded' }).toString()}`,
                        window.location.href,
                      ).href,
                    }}
                  />
                </details>
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
