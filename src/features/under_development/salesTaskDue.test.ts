import { describe, it, expect } from 'vitest';
import { isDueToday } from './salesTaskDue';

describe('isDueToday', () => {
  const now = new Date(2026, 7, 31, 12, 0); // Mon Aug 31 2026, local
  it('same local day → true', () => {
    expect(isDueToday(new Date(2026, 7, 31, 9, 30).toISOString(), now)).toBe(true);
    expect(isDueToday(new Date(2026, 7, 31, 23, 59).toISOString(), now)).toBe(true);
  });
  it('audit bug: a FUTURE month sharing the day-of-month is NOT today (Aug 31 vs Oct 31)', () => {
    expect(isDueToday(new Date(2026, 9, 31, 10, 0).toISOString(), now)).toBe(false);
  });
  it('yesterday and tomorrow → false', () => {
    expect(isDueToday(new Date(2026, 7, 30, 10, 0).toISOString(), now)).toBe(false);
    expect(isDueToday(new Date(2026, 8, 1, 0, 0).toISOString(), now)).toBe(false);
  });
});
