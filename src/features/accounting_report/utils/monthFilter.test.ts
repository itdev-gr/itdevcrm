import { describe, it, expect } from 'vitest';
import { monthOptions, monthRange } from './monthFilter';

describe('monthFilter', () => {
  it('produces 24 months, newest first, from the given date', () => {
    const opts = monthOptions(new Date('2026-07-15T00:00:00Z'));
    expect(opts).toHaveLength(24);
    expect(opts[0]!.value).toBe('2026-07');
    expect(opts[1]!.value).toBe('2026-06');
    expect(opts[23]!.value).toBe('2024-08');
  });

  it('monthRange returns first and last day of the month', () => {
    expect(monthRange('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});
