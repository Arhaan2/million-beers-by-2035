import { describe, expect, it } from 'vitest';
import { adjacentPeriod, periodLabel, periodRange, validPeriod } from './recaps';
describe('recap calendar navigation', () => {
  it('retains leap days and calendar month boundaries through DST months', () => {
    expect(periodRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(periodRange('2026-03').to).toBe('2026-03-31');
    expect(periodRange('2026-11').to).toBe('2026-11-30');
    expect(periodRange('1900-02').to).toBe('1900-02-28');
    expect(periodRange('2000-02').to).toBe('2000-02-29');
    expect(periodRange('9999').to).toBe('9999-12-31');
  });
  it('navigates across years without invalid zero or five digit years', () => {
    expect(adjacentPeriod('2026-12', 1)).toBe('2027-01');
    expect(adjacentPeriod('2026-01', -1)).toBe('2025-12');
    expect(adjacentPeriod('0001', -1)).toBeNull();
    expect(adjacentPeriod('9999-12', 1)).toBeNull();
    expect(validPeriod('2026-13')).toBe(false);
    expect(validPeriod('0000')).toBe(false);
    expect(periodLabel('2026-10')).toBe('October 2026');
  });
});
