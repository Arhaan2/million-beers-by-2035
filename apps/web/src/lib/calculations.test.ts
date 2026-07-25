import { describe, expect, it } from 'vitest';
import {
  averagePerElapsedDay,
  countdownTo,
  percentComplete,
  projectedTargetFinishAt,
  remainingCount,
  requiredPerDay,
} from './calculations';
import { formatPercent } from './format';

const start = '2026-07-24T00:00:00-07:00';
const deadline = '2035-01-01T00:00:00-08:00';

describe('challenge calculations', () => {
  it('never returns a negative remaining count', () => {
    expect(remainingCount(250, 1_000)).toBe(750);
    expect(remainingCount(1_250, 1_000)).toBe(0);
  });

  it('formats visible progress near zero', () => {
    expect(percentComplete(1, 1_000_000)).toBeCloseTo(0.0001);
    expect(formatPercent(0.0001)).toBe('0.0001%');
  });

  it('caps completed challenge progress', () => {
    expect(percentComplete(1_100_000, 1_000_000)).toBe(100);
  });

  it('calculates countdown units and handles the deadline', () => {
    const now = new Date('2034-12-30T00:00:00-08:00').getTime();
    expect(countdownTo(deadline, now)).toMatchObject({ days: 2, hours: 0, complete: false });
    expect(countdownTo(deadline, new Date(deadline).getTime()).complete).toBe(true);
  });

  it('calculates average and required group pace', () => {
    const now = new Date('2026-07-26T00:00:00-07:00').getTime();
    expect(averagePerElapsedDay(10, start, now)).toBe(5);
    expect(requiredPerDay(0, 1_000, '2026-08-03T00:00:00-07:00', now)).toBeCloseTo(125);
  });

  it('projects target finish from the current group pace', () => {
    const now = new Date('2026-07-26T00:00:00-07:00').getTime();
    const projected = projectedTargetFinishAt(10, 100, start, now);
    expect(projected).toBe(new Date('2026-08-13T00:00:00-07:00').getTime());
  });

  it('returns no pace before positive progress exists', () => {
    expect(averagePerElapsedDay(0, start, Date.now())).toBeNull();
    expect(projectedTargetFinishAt(0, 1_000, start, Date.now())).toBeNull();
  });
});
