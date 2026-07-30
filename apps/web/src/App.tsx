import { useEffect, useMemo, useState } from 'react';
import { ActivityFeed } from './components/ActivityFeed';
import { Countdown } from './components/Countdown';
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
import { formatDecimal, formatInteger } from './lib/format';
import { clearSession, readSession, storeSession } from './lib/session';
import type { EditorSession, EntryPayload } from './lib/types';

const REPOSITORY_URL = 'https://github.com/Arhaan2/million-beers-by-2035';

function App() {
  const { summary, loading, degraded, lastSuccessAt, refresh } = useDashboard();
  const [session, setSession] = useState<EditorSession | null>(() => readSession());
  const [loginOpen, setLoginOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    if (!session) return;
    void validateSession(session.token).catch((error: unknown) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession();
        setSession(null);
      }
    });
  }, [session]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const metrics = useMemo(() => {
    if (!summary) return null;
    const { total } = summary.stats;
    const { target, startAt, deadlineAt, timezone } = summary.challenge;
    const average = averagePerElapsedDay(total, startAt);
    const required = requiredPerDay(total, target, deadlineAt);
    const projected = projectedTargetFinishAt(total, target, startAt);
    const milestone = nextMilestone(total, target);
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return {
      average,
      required,
      projected: projected ? dateFormatter.format(projected) : null,
      milestone,
      overage: Math.max(0, total - target),
    };
  }, [summary]);

  const handleLogin = async (code: string): Promise<EditorSession> => {
    const nextSession = await login(code);
    storeSession(nextSession);
    setSession(nextSession);
    setLoginOpen(false);
    setToast({ message: 'Editor unlocked for this tab.', kind: 'success' });
    return nextSession;
  };

  const handleSubmit = async (payload: EntryPayload): Promise<void> => {
    if (!session) throw new ApiRequestError('Your editor session has expired.', 401);
    try {
      await submitEntry(payload, session.token);
      await refresh();
      setUpdateOpen(false);
      setToast({
        message:
          payload.totalAmount > 0
            ? `Added ${payload.totalAmount} beers to the board.`
            : `Recorded a correction of ${payload.totalAmount}.`,
        kind: 'success',
      });
      if (payload.totalAmount > 0) {
        setCelebrating(true);
        window.setTimeout(() => setCelebrating(false), 1_800);
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession();
        setSession(null);
        setUpdateOpen(false);
        setToast({ message: 'Your editor session expired. Log in again.', kind: 'error' });
      }
      throw error;
    }
  };

  const logout = () => {
    clearSession();
    setSession(null);
    setUpdateOpen(false);
    setToast({ message: 'Editor session removed from this tab.', kind: 'success' });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to dashboard
      </a>
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <DashboardHeader
        loggedIn={Boolean(session)}
        degraded={degraded}
        lastSuccessAt={lastSuccessAt}
        onLogin={() => setLoginOpen(true)}
        onAdd={() => setUpdateOpen(true)}
        onLogout={logout}
      />
      <main id="main-content">
        {summary && metrics ? (
          <>
            <div className="hero-grid">
              <ProgressDisplay
                total={summary.stats.total}
                target={summary.challenge.target}
                remaining={summary.stats.remaining}
                percent={summary.stats.percentComplete}
              />
              <Countdown deadlineAt={summary.challenge.deadlineAt} />
            </div>
            <section className="stats-section" aria-labelledby="stats-heading">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Scoreboard math</p>
                  <h2 id="stats-heading">The pace at a glance</h2>
                </div>
                <p>Group metrics only — never a personal drinking target.</p>
              </div>
              <div className="stats-grid">
                <StatCard
                  label="Beers recorded"
                  value={formatInteger(summary.stats.total)}
                  detail={
                    metrics.overage > 0
                      ? `${formatInteger(metrics.overage)} over target`
                      : 'Net of corrections'
                  }
                />
                <StatCard
                  label="Beers remaining"
                  value={formatInteger(summary.stats.remaining)}
                  detail={
                    summary.stats.total >= summary.challenge.target
                      ? 'Challenge complete'
                      : 'To the finish line'
                  }
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
                  detail="Collective target pace"
                />
                <StatCard
                  label="Projected finish"
                  value={metrics.projected ?? 'No pace yet'}
                  detail="At the current group pace"
                />
                <StatCard
                  label="Recorded updates"
                  value={formatInteger(summary.stats.eventCount)}
                  detail="Append-only entries"
                />
                <StatCard
                  label="Next milestone"
                  value={formatInteger(metrics.milestone)}
                  detail={`${formatInteger(Math.max(0, metrics.milestone - summary.stats.total))} to go`}
                />
              </div>
            </section>
            <TrendChart days={summary.dailyTotals} />
            <div className="content-grid">
              <ActivityFeed entries={summary.recentEntries} timezone={summary.challenge.timezone} />
              <Leaderboard entries={summary.leaderboard} />
            </div>
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
                : 'No data was lost. Try the connection again.'}
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
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          View the source on GitHub <span aria-hidden="true">↗</span>
        </a>
      </footer>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSubmit={handleLogin} />
      <UpdateModal
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        onSubmit={handleSubmit}
        suggestedContributors={summary?.leaderboard.map((entry) => entry.contributor) ?? []}
      />
      <Toast message={toast?.message ?? null} kind={toast?.kind ?? 'success'} />
      {celebrating ? (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default App;
