import { describe, expect, it } from 'vitest';
import { formatRate, openRateDisplay, rate } from './campaignCopy';

describe('rate', () => {
  it('returns null when the denominator is 0 — never NaN, never Infinity', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(5, 0)).toBeNull();
  });

  it('computes a normal ratio', () => {
    expect(rate(25, 100)).toBe(0.25);
    expect(rate(1, 3)).toBeCloseTo(0.3333, 4);
  });
});

describe('formatRate', () => {
  it('renders «—» for null, never «NaN%» or «0%»', () => {
    expect(formatRate(null)).toBe('—');
  });

  it('renders a normal ratio as a one-decimal percentage', () => {
    expect(formatRate(0.25)).toBe('25.0%');
    expect(formatRate(rate(1, 4))).toBe('25.0%');
  });

  it('never produces NaN% for a zero-denominator rate flowing through', () => {
    expect(formatRate(rate(5, 0))).toBe('—');
    expect(formatRate(rate(5, 0))).not.toContain('NaN');
  });
});

describe('openRateDisplay', () => {
  it('says «δεν μετράται» when tracking is off — NOT «0%», even with real send counts', () => {
    const stats = { sent: 4312, opened: 0 };
    expect(openRateDisplay(stats, false)).toBe('δεν μετράται');
    expect(openRateDisplay(stats, false)).not.toBe('0%');
  });

  it('says «δεν μετράται» when tracking is off even with zero sends (no NaN escape hatch)', () => {
    expect(openRateDisplay({ sent: 0 }, false)).toBe('δεν μετράται');
  });

  it('computes the real open rate once tracking is on', () => {
    expect(openRateDisplay({ sent: 100, opened: 40 }, true)).toBe('40.0%');
  });

  it('renders «—» when tracking is on but nothing has sent yet', () => {
    expect(openRateDisplay({ sent: 0, opened: 0 }, true)).toBe('—');
  });
});
