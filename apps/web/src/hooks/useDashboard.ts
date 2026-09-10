import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSummary } from '../lib/api';
import type { DashboardSummary, EntryResult } from '../lib/types';

// Ordering is independent of the total: a newer correction may reduce it.
export function useDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const acceptedRevision = useRef(-1);
  const mutationEpoch = useRef(0);
  const tail = useRef<Promise<boolean>>(Promise.resolve(true));
  const mounted = useRef(true);

  const refresh = useCallback((): Promise<boolean> => {
    // Every caller gets a fetch begun after earlier work completes. In particular,
    // an in-flight poll can never swallow the reconciliation requested by a save.
    const next = tail.current.then(async () => {
      const epoch = mutationEpoch.current;
      try {
        const value = await fetchSummary();
        if (!mounted.current) return false;
        const revision = value.revision ?? value.stats.revision;
        if (
          revision === undefined
            ? epoch !== mutationEpoch.current
            : revision < acceptedRevision.current
        ) {
          return false;
        }
        if (revision !== undefined) acceptedRevision.current = revision;
        setSummary(value);
        setLastSuccessAt(Date.now());
        setDegraded(false);
        return true;
      } catch {
        if (mounted.current) setDegraded(true);
        return false;
      } finally {
        if (mounted.current) setLoading(false);
      }
    });
    tail.current = next;
    return next;
  }, []);

  const applyMutation = useCallback((result: EntryResult) => {
    mutationEpoch.current += 1;
    const revision = result.revision ?? result.stats.revision;
    if (revision !== undefined && revision < acceptedRevision.current) return;
    if (revision !== undefined) acceptedRevision.current = revision;
    setSummary((current) =>
      current
        ? {
            ...current,
            ...(revision === undefined ? {} : { revision }),
            stats: {
              ...current.stats,
              ...result.stats,
              eventCount: result.stats.entryCount,
              remaining:
                result.stats.remaining ??
                Math.max(0, current.challenge.target - result.stats.total),
              percentComplete: Math.min(100, (result.stats.total / current.challenge.target) * 100),
            },
            ...(current.recentCommunityEntries && result.entry && !result.entry.isSystem
              ? {
                  recentCommunityEntries: [
                    result.entry,
                    ...current.recentCommunityEntries.filter(
                      (entry) => entry.id !== result.entry?.id,
                    ),
                  ].slice(0, 25),
                }
              : {}),
            recentEntries: result.entry
              ? [
                  result.entry,
                  ...current.recentEntries.filter((entry) => entry.id !== result.entry?.id),
                ].slice(0, 12)
              : current.recentEntries,
          }
        : current,
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 25_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mounted.current = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  return { summary, loading, degraded, lastSuccessAt, refresh, applyMutation };
}
