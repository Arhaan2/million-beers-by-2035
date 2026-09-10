import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrencePayload } from './occurrence';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-09T19:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('occurrence date/time entry', () => {
  it('keeps occurrence unknown when no date was entered', () => {
    expect(occurrencePayload('', '', 'America/Los_Angeles')).toBeUndefined();
  });
  it('records date-only precision explicitly and handles local midnight', () => {
    expect(occurrencePayload('2026-07-24', '', 'America/Los_Angeles')).toEqual({
      occurredAt: '2026-07-24T00:00:00-07:00',
      occurrenceTimezone: 'America/Los_Angeles',
      occurrencePrecision: 'day',
    });
  });
  it('rejects the nonexistent spring DST hour', () => {
    expect(() => occurrencePayload('2026-03-08', '02:30', 'America/Los_Angeles')).toThrow(
      /does not exist/u,
    );
  });
  it('requires date-only entry for an ambiguous fall DST hour', () => {
    expect(() => occurrencePayload('2025-11-02', '01:30', 'America/Los_Angeles')).toThrow(
      /occurs twice/u,
    );
    expect(occurrencePayload('2025-11-02', '', 'America/Los_Angeles')?.occurrencePrecision).toBe(
      'day',
    );
  });
  it.each([
    ['2026-02-30', '12:00', 'UTC'],
    ['2026-08-10', '24:00', 'UTC'],
    ['2026-07-24', '10:00', 'Not/A_Zone'],
  ])('rejects invalid civil date/time or zone %s %s %s', (date, time, zone) => {
    expect(() => occurrencePayload(date, time, zone)).toThrow();
  });
  it('rejects future occurrence dates', () => {
    expect(() => occurrencePayload('2026-09-10', '', 'America/Los_Angeles')).toThrow(/future/u);
  });
  it('handles a fractional-hour timezone without inventing seconds', () => {
    expect(occurrencePayload('2026-07-24', '23:45', 'Asia/Kathmandu')).toEqual({
      occurredAt: '2026-07-24T23:45:00+05:45',
      occurrenceTimezone: 'Asia/Kathmandu',
      occurrencePrecision: 'minute',
    });
  });
});
