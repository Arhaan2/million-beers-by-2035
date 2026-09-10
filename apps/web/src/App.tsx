import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityFeed } from './components/ActivityFeed';
import {
  AboutPage,
  CrewPage,
  EntryDetail,
  HistoryPage,
  MemberPageView,
  MilestoneHistory,
  RecapsPage,
} from './components/CommunityPages';
import { DashboardHeader } from './components/DashboardHeader';
import { Leaderboard } from './components/Leaderboard';
import { LoginModal } from './components/LoginModal';
import { ProgressDisplay } from './components/ProgressDisplay';
import { StatCard } from './components/StatCard';
import { Toast } from './components/Toast';
import { TrendChart } from './components/TrendChart';
import { UpdateModal } from './components/UpdateModal';
import { useDashboard } from './hooks/useDashboard';
import {
  averagePerElapsedDay,
  nextMilestone,
  projectedTargetFinishAt,
  requiredPerDay,
} from './lib/calculations';
import { ApiRequestError, login, submitEntry, validateSession } from './lib/api';
import { readDraft } from './lib/drafts';
import { formatDecimal, formatInteger } from './lib/format';
import { clearSession, readSession, storeSession } from './lib/session';
import type { BeerEntry, EditorSession, EntryPayload } from './lib/types';

const readRoute = () =>
  window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : '/';
function App() {
  const { summary, loading, degraded, lastSuccessAt, refresh, applyMutation } = useDashboard();
  const [session, setSession] = useState<EditorSession | null>(readSession);
  const [loginOpen, setLoginOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const [saveNotice, setSaveNotice] = useState('');
  const [route, setRoute] = useState(readRoute);
  const [correctionSource, setCorrectionSource] = useState<BeerEntry | undefined>();
  const openAfterLogin = useRef(false);
  const saveSequence = useRef(0);
  useEffect(() => {
    const change = () => {
      setRoute(readRoute());
      window.setTimeout(() => document.getElementById('page-title')?.focus(), 0);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void validateSession(session.token).catch((error: unknown) => {
      if (!cancelled && error instanceof ApiRequestError && error.status === 401) {
        clearSession();
        setSession(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const metrics = useMemo(() => {
    if (!summary) return null;
    const { total } = summary.stats;
    const { target, startAt, deadlineAt, timezone } = summary.challenge;
    const projected = projectedTargetFinishAt(total, target, startAt);
    return {
      average: averagePerElapsedDay(total, startAt),
      required: requiredPerDay(total, target, deadlineAt),
      milestone: nextMilestone(total, target),
      projected: projected
        ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'medium' }).format(
            projected,
          )
        : null,
      deadline: new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'long' }).format(
        new Date(deadlineAt),
      ),
    };
  }, [summary]);
  const record = () => {
    setCorrectionSource(undefined);
    if (session) setUpdateOpen(true);
    else {
      openAfterLogin.current = true;
      setLoginOpen(true);
    }
  };
  const correct = (entry: BeerEntry) => {
    setCorrectionSource(entry);
    if (session) setUpdateOpen(true);
    else {
      openAfterLogin.current = true;
      setLoginOpen(true);
    }
  };
  const handleLogin = async (code: string): Promise<EditorSession> => {
    const next = await login(code);
    storeSession(next);
    setSession(next);
    setLoginOpen(false);
    if (openAfterLogin.current || readDraft()?.attempt) {
      openAfterLogin.current = false;
      setUpdateOpen(true);
    }
    setToast({ message: 'Editor unlocked for this tab.', kind: 'success' });
    return next;
  };
  const handleSubmit = async (payload: EntryPayload): Promise<void> => {
    if (!session) {
      openAfterLogin.current = true;
      setUpdateOpen(false);
      setLoginOpen(true);
      throw new ApiRequestError('Sign in to retry the saved attempt.', 401);
    }
    try {
      const result = await submitEntry(payload, session.token);
      applyMutation(result);
      setUpdateOpen(false);
      const sequence = ++saveSequence.current;
      setSaveNotice('Saved. Refreshing the shared dashboard…');
      setToast({
        message: result.idempotent
          ? 'Saved entry confirmed. No duplicate was created.'
          : 'Entry saved to the ledger.',
        kind: 'success',
      });
      void refresh().then((refreshed) => {
        if (sequence === saveSequence.current)
          setSaveNotice(
            refreshed
              ? 'Saved and refreshed.'
              : 'Saved, but the summary refresh failed. Your entry is recorded; the last confirmed total is shown.',
          );
      });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession();
        setSession(null);
        openAfterLogin.current = true;
        setUpdateOpen(false);
        setLoginOpen(true);
      }
      throw error;
    }
  };
  const logout = () => {
    clearSession();
    setSession(null);
    setUpdateOpen(false);
    setToast({
      message: 'Editor session removed from this tab. Unresolved drafts are kept.',
      kind: 'success',
    });
  };
  const [path, query = ''] = route.split('?');
  const section = path?.split('/')[1] ?? '';
  const encodedId = path?.split('/')[2] ?? '';
  let id = encodedId;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    /* Missing record UI handles malformed links. */
  }
  const capabilities = summary?.capabilities;
  const timezone = summary?.challenge.timezone ?? 'America/Los_Angeles';
  const supported =
    !section ||
    section === 'about' ||
    (section === 'crew' || section === 'member'
      ? capabilities?.crew
      : section === 'history' || section === 'entry' || section === 'recaps'
        ? capabilities?.history
        : false);
  const community = summary?.community;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <DashboardHeader
        loggedIn={Boolean(session)}
        degraded={degraded}
        lastSuccessAt={lastSuccessAt}
        onLogin={() => setLoginOpen(true)}
        onAdd={record}
        onLogout={logout}
      />
      <nav className="main-nav" aria-label="Main navigation">
        {[
          ['', 'Dashboard'],
          ['crew', 'Crew'],
          ['history', 'History'],
          ['recaps', 'Recaps'],
          ['about', 'About'],
        ].map(([slug, label]) => (
          <a
            key={slug}
            href={`#/${slug}`}
            aria-current={
              section === slug ||
              (slug === 'crew' && section === 'member') ||
              (slug === 'history' && section === 'entry')
                ? 'page'
                : undefined
            }
          >
            {label}
          </a>
        ))}
      </nav>
      <main id="main-content" tabIndex={-1}>
        {saveNotice ? (
          <div className="save-notice" role="status">
            <span>{saveNotice}</span>
            <button
              className="text-button"
              onClick={() => setSaveNotice('')}
              aria-label="Dismiss save status"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {degraded && summary ? (
          <p className="notice">
            The live connection is delayed. Last confirmed records remain visible.{' '}
            <button className="text-button" onClick={() => void refresh()}>
              Refresh now
            </button>
          </p>
        ) : null}
        {section === 'about' ? (
          <AboutPage summary={summary} />
        ) : !supported && summary ? (
          <div className="page-status">
            <h2>These features are not enabled by the server yet.</h2>
            <p>The counter and existing recording workflow remain available.</p>
            <a className="button button--outline" href="#/">
              Return to dashboard
            </a>
          </div>
        ) : section === 'crew' ? (
          <CrewPage key={route} query={query} />
        ) : section === 'member' ? (
          <MemberPageView key={route} id={id} timezone={timezone} />
        ) : section === 'history' ? (
          <HistoryPage key={route} query={query} timezone={timezone} />
        ) : section === 'entry' ? (
          <EntryDetail
            key={route}
            id={id}
            timezone={timezone}
            capabilities={capabilities}
            token={session?.token}
            onCorrect={correct}
          />
        ) : section === 'recaps' ? (
          <RecapsPage key={route} query={query} timezone={timezone} />
        ) : summary && metrics ? (
          <>
            <div className="hero-grid">
              <ProgressDisplay
                total={summary.stats.total}
                target={summary.challenge.target}
                remaining={summary.stats.remaining}
                percent={summary.stats.percentComplete}
              />
              <section className="gather-panel">
                <p className="eyebrow">The next chapter starts here</p>
                <h2>
                  Good company. <br />A shared story.
                </h2>
                <p>A place for the occasions, familiar faces and little details along the way.</p>
                <button className="button button--primary" onClick={record}>
                  {readDraft()?.attempt ? 'Resolve saved submission' : 'Record entry'}
                </button>
                <p className="deadline">
                  Until {metrics.deadline}
                  <br />
                  <span>{summary.challenge.timezone}</span>
                </p>
              </section>
            </div>
            <div className="collective-milestone">
              <span>Next collective milestone</span>
              <strong>{formatInteger(metrics.milestone)}</strong>
              <span>
                {formatInteger(Math.max(0, metrics.milestone - summary.stats.total))} away · net of
                corrections
              </span>
            </div>
            <section className="crew-strip" aria-label="Crew overview">
              <div className="crew-strip__avatars" aria-hidden="true">
                {(summary.leaderboard.length
                  ? summary.leaderboard.slice(0, 4).map((member) => member.contributor)
                  : ['M', 'B']
                ).map((name, index) => (
                  <span className="avatar" key={`${name}-${index}`}>
                    {name.slice(0, 2)}
                  </span>
                ))}
              </div>
              <div>
                <h2>A shared ledger, a growing crew.</h2>
                <p>
                  {community
                    ? `${community.namedContributors} named contributors · ${community.activeParticipants} recent active participants`
                    : `${summary.stats.crewSize} named contributor records`}
                </p>
              </div>
              <a href="#/crew">
                Meet the crew <span aria-hidden="true">↗</span>
              </a>
            </section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Keep more than the number</p>
                <h2>Recent moments & activity</h2>
              </div>
              <a href="#/history">Explore all history →</a>
            </div>
            <div className="content-grid">
              <ActivityFeed
                entries={(
                  summary.recentCommunityEntries ??
                  summary.recentEntries.filter((entry) => !entry.isSystem)
                ).slice(0, 6)}
                timezone={timezone}
              />
              <aside className="panel story-panel">
                <p className="eyebrow">Made for remembering</p>
                <h2>The occasion matters.</h2>
                <p>
                  A title, a familiar place, a small note. Add a little context when you record, or
                  return to the saved record later.
                </p>
                <a href="#/recaps">Look back through recaps →</a>
                <div className="story-mark" aria-hidden="true">
                  01M<span>BY 2035</span>
                </div>
              </aside>
            </div>
            <TrendChart days={summary.dailyTotals} />
            <details className="statistics">
              <summary>
                Explore the numbers <span>Collective pace, forecasts & audit counts</span>
              </summary>
              <p className="helper">
                Pace and finish dates are mathematical extrapolations, not predictions or personal
                recommendations.
              </p>
              <div className="stats-grid">
                <StatCard
                  label="Beers remaining"
                  value={formatInteger(summary.stats.remaining)}
                  detail="To the collective target"
                />
                <StatCard
                  label="Named contributor records"
                  value={formatInteger(summary.stats.crewSize)}
                  detail="Legacy metric; unverified display labels"
                />
                <StatCard
                  label="Recorded updates"
                  value={formatInteger(summary.stats.eventCount)}
                  detail="All append-only entries, including operational records"
                />
                <StatCard
                  label="Raw allocation count"
                  value={formatInteger(summary.stats.allocationCount)}
                  detail="Every preserved allocation"
                />
                <StatCard
                  label="Group average / elapsed day"
                  value={metrics.average ? formatDecimal(metrics.average, 2) : 'No pace yet'}
                  detail="Historical collective rate"
                />
                <StatCard
                  label="Math required / remaining day"
                  value={
                    Number.isFinite(metrics.required)
                      ? formatDecimal(metrics.required, 1)
                      : 'Deadline passed'
                  }
                  detail="Group metric, not a recommendation"
                />
                <StatCard
                  label="Math required / week"
                  value={
                    Number.isFinite(metrics.required) ? formatDecimal(metrics.required * 7, 0) : '—'
                  }
                  detail="Collective target math"
                />
                <StatCard
                  label="Extrapolated finish"
                  value={metrics.projected ?? 'No pace yet'}
                  detail="At the historical group rate; not a prediction"
                />
              </div>
              <div className="secondary-ledger">
                <Leaderboard entries={summary.leaderboard} />
                <MilestoneHistory revision={summary.revision ?? 0} />
              </div>
            </details>
          </>
        ) : (
          <section className="loading-state" role="status">
            <div className="loading-mark" aria-hidden="true" />
            <h2>
              {loading ? 'Lighting up the scoreboard…' : 'The scoreboard is temporarily offline'}
            </h2>
            <p>
              {loading
                ? 'Fetching the live total from the crew ledger.'
                : 'The latest data could not be retrieved. Try the connection again.'}
            </p>
            {!loading ? (
              <button className="button button--primary" onClick={() => void refresh()}>
                Retry connection
              </button>
            ) : null}
          </section>
        )}
      </main>
      <footer>
        <p>
          For adults of legal drinking age. Track responsibly. This counter is not a drinking
          recommendation. Never drink and drive.
        </p>
        <a href="https://github.com/Arhaan2/million-beers-by-2035" target="_blank" rel="noreferrer">
          View the source on GitHub ↗
        </a>
      </footer>
      <LoginModal
        open={loginOpen}
        onClose={() => {
          setLoginOpen(false);
          openAfterLogin.current = false;
        }}
        onSubmit={handleLogin}
      />
      {updateOpen ? (
        <UpdateModal
          open
          onClose={() => setUpdateOpen(false)}
          onSubmit={handleSubmit}
          capabilities={capabilities}
          token={session?.token}
          initialCorrection={correctionSource}
        />
      ) : null}
      <Toast message={toast?.message ?? null} kind={toast?.kind ?? 'success'} />
    </div>
  );
}
export default App;
