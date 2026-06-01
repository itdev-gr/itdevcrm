import { describe, it, expect } from 'vitest';
import { rangeForPreset, formatIsoDate, periodOf } from './formatRange';

describe('formatRange', () => {
  it('this_month returns first/last day of the given anchor month', () => {
    const r = rangeForPreset('this_month', new Date('2026-06-15T12:00:00Z'));
    expect(r).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('last_month wraps the year correctly on Jan', () => {
    const r = rangeForPreset('last_month', new Date('2026-01-10T00:00:00Z'));
    expect(r).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('this_year covers Jan 1 - Dec 31 of the anchor year', () => {
    const r = rangeForPreset('this_year', new Date('2026-06-15T00:00:00Z'));
    expect(r).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('last_year covers prior calendar year', () => {
    const r = rangeForPreset('last_year', new Date('2026-06-15T00:00:00Z'));
    expect(r).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('formatIsoDate formats a Date to YYYY-MM-DD in UTC', () => {
    expect(formatIsoDate(new Date('2026-06-09T22:00:00Z'))).toBe('2026-06-09');
  });

  it('periodOf extracts YYYY-MM from YYYY-MM-DD', () => {
    expect(periodOf('2026-06-15')).toBe('2026-06');
  });
});
