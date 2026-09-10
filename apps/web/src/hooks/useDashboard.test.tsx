import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSummary } from '../lib/api';
import type { DashboardSummary, EntryResult } from '../lib/types';
import { useDashboard } from './useDashboard';

vi.mock('../lib/api', () => ({ fetchSummary: vi.fn() }));

function summary(total: number, revision?: number): DashboardSummary {
  return {
    ...(revision === undefined ? {} : { revision }),
    challenge: {
      target: 1000000,
      startAt: '2026-07-24T00:00:00-07:00',
      deadlineAt: '2035-01-01T00:00:00-08:00',
      timezone: 'America/Los_Angeles',
    },
    stats: {
      total,
      remaining: 1000000 - total,
      eventCount: 1,
      entryCount: 1,
      allocationCount: 1,
      crewSize: 1,
      percentComplete: total / 10000,
      updatedAt: 1,
    },
    recentEntries: [],
    recentEvents: [],
    leaderboard: [],
    dailyTotals: [],
  };
}

function mutation(total: number, revision?: number): EntryResult {
  return {
    ...(revision === undefined ? {} : { revision }),
    stats: { total, entryCount: 2, allocationCount: 2 },
    idempotent: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchSummary).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('dashboard reconciliation ordering', () => {
  it('queues post-save reconciliation behind a poll and rejects the stale poll after a reducing correction', async () => {
    const poll = deferred<DashboardSummary>();
    vi.mocked(fetchSummary)
      .mockResolvedValueOnce(summary(10, 1))
      .mockReturnValueOnce(poll.promise)
      .mockResolvedValueOnce(summary(7, 2));
    const { result } = renderHook(useDashboard);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    let polling!: Promise<boolean>;
    await act(async () => {
      polling = result.current.refresh();
      await Promise.resolve();
    });
    expect(fetchSummary).toHaveBeenCalledTimes(2);
    let reconciliation!: Promise<boolean>;
    act(() => {
      result.current.applyMutation(mutation(7, 2));
      reconciliation = result.current.refresh();
    });
    expect(result.current.summary?.stats.total).toBe(7);
    expect(fetchSummary).toHaveBeenCalledTimes(2);
    await act(async () => {
      poll.resolve(summary(10, 1));
      expect(await polling).toBe(false);
      expect(await reconciliation).toBe(true);
    });
    expect(fetchSummary).toHaveBeenCalledTimes(3);
    expect(result.current.summary?.stats.total).toBe(7);
    expect(result.current.summary?.revision).toBe(2);
  });

  it('keeps the confirmed mutation when refreshing fails and reports a degraded summary', async () => {
    vi.mocked(fetchSummary)
      .mockResolvedValueOnce(summary(10, 1))
      .mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(useDashboard);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      result.current.applyMutation(mutation(14, 2));
    });
    await act(async () => {
      expect(await result.current.refresh()).toBe(false);
    });
    expect(result.current.summary?.stats.total).toBe(14);
    expect(result.current.degraded).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('does not apply an older mutation response over a newer revision', async () => {
    vi.mocked(fetchSummary).mockResolvedValueOnce(summary(7, 5));
    const { result } = renderHook(useDashboard);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      result.current.applyMutation(mutation(10, 4));
    });
    expect(result.current.summary?.stats.total).toBe(7);
    expect(result.current.summary?.revision).toBe(5);
  });

  it('fences an old response from a legacy API without a revision', async () => {
    const poll = deferred<DashboardSummary>();
    vi.mocked(fetchSummary)
      .mockResolvedValueOnce(summary(10))
      .mockReturnValueOnce(poll.promise)
      .mockResolvedValueOnce(summary(9));
    const { result } = renderHook(useDashboard);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    let polling!: Promise<boolean>;
    await act(async () => {
      polling = result.current.refresh();
      await Promise.resolve();
    });
    act(() => {
      result.current.applyMutation(mutation(9));
    });
    await act(async () => {
      poll.resolve(summary(10));
      expect(await polling).toBe(false);
    });
    expect(result.current.summary?.stats.total).toBe(9);
    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    expect(result.current.summary?.stats.total).toBe(9);
  });

  it('accepts a newer reducing summary without treating total as a monotonic clock', async () => {
    vi.mocked(fetchSummary)
      .mockResolvedValueOnce(summary(10, 4))
      .mockResolvedValueOnce(summary(3, 5));
    const { result } = renderHook(useDashboard);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    expect(result.current.summary?.stats.total).toBe(3);
    expect(result.current.summary?.revision).toBe(5);
  });
});
