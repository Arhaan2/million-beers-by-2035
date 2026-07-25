import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSummary } from '../lib/api';
import type { DashboardSummary } from '../lib/types';

export function useDashboard(): {
  summary: DashboardSummary | null;
  loading: boolean;
  degraded: boolean;
  lastSuccessAt: number | null;
  refresh: () => Promise<void>;
} {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await fetchSummary();
      setSummary(next);
      setLastSuccessAt(Date.now());
      setDegraded(false);
    } catch {
      setDegraded(true);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 25_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  return { summary, loading, degraded, lastSuccessAt, refresh };
}
