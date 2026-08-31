import { describe, it, expect } from 'vitest';
import { isoDay, localDayBounds, rangeFor } from './dateRange';

describe('isoDay', () => {
  it('formats the LOCAL calendar day, zero-padded', () => {
    expect(isoDay(new Date(2026, 8, 1, 0, 30))).toBe('2026-09-01'); // 00:30 local stays 1 Sep
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('localDayBounds', () => {
  it('bounds are the exact UTC instants of local midnights (from, and day after to)', () => {
    const b = localDayBounds({ from: '2026-08-31', to: '2026-08-31' });
    expect(b.fromIso).toBe(new Date(2026, 7, 31).toISOString());
    expect(b.toIsoExclusive).toBe(new Date(2026, 8, 1).toISOString());
  });

  it('a lead created 00:30 local on the from-day is inside the bounds', () => {
    const b = localDayBounds({ from: '2026-08-31', to: '2026-08-31' });
    const halfPastMidnight = new Date(2026, 7, 31, 0, 30).toISOString();
    expect(halfPastMidnight >= b.fromIso).toBe(true);
    expect(halfPastMidnight < b.toIsoExclusive).toBe(true);
  });

  it('23:59:59.999 local on the to-day is still inside (exclusive upper bound)', () => {
    const b = localDayBounds({ from: '2026-08-01', to: '2026-08-31' });
    const lastMs = new Date(2026, 7, 31, 23, 59, 59, 999).toISOString();
    expect(lastMs < b.toIsoExclusive).toBe(true);
  });

  it('handles the October DST change without losing or duplicating an hour boundary', () => {
    // 2026-10-25 is the EU summer->winter change; the day is 25h long locally.
    const b = localDayBounds({ from: '2026-10-25', to: '2026-10-25' });
    const spanH = (Date.parse(b.toIsoExclusive) - Date.parse(b.fromIso)) / 3_600_000;
    expect(spanH === 24 || spanH === 25).toBe(true); // 25 in a DST-observing zone, 24 otherwise
  });
});

describe('rangeFor', () => {
  const now = new Date(2026, 8, 1, 0, 30); // 1 Sep 2026, 00:30 LOCAL (03:30 after months change in UTC+3)

  it('this_month starts on the 1st of the LOCAL month even just after local midnight', () => {
    expect(rangeFor('this_month', now)).toEqual({ from: '2026-09-01', to: '2026-09-01' });
  });

  it('last_month is the full previous local month', () => {
    expect(rangeFor('last_month', now)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('this_year starts Jan 1', () => {
    expect(rangeFor('this_year', now)).toEqual({ from: '2026-01-01', to: '2026-09-01' });
  });

  it('last_6_months = current month + 5 prior, from the 1st', () => {
    expect(rangeFor('last_6_months', now)).toEqual({ from: '2026-04-01', to: '2026-09-01' });
  });

  it('last_12_months = current month + 11 prior, across the year boundary', () => {
    expect(rangeFor('last_12_months', now)).toEqual({ from: '2025-10-01', to: '2026-09-01' });
  });
});
