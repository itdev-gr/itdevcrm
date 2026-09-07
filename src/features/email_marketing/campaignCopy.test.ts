import { describe, expect, it } from 'vitest';
import { campaignTargetCount, formatRate, openRateDisplay, rate } from './campaignCopy';

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

describe('campaignTargetCount', () => {
  it('returns null when nothing has been built yet (no stats payload)', () => {
    expect(campaignTargetCount(undefined, null)).toBeNull();
    expect(campaignTargetCount(null, null)).toBeNull();
  });

  it('mid-send: sums every status except suppressed — the same 4,312 the dashboard shows, not just the shrinking "pending" count', () => {
    const stats = { by_status: { pending: 3000, sending: 12, sent: 1300, suppressed: 688 } };
    expect(campaignTargetCount(stats, '2026-09-07T00:00:00Z')).toBe(4312);
  });

  it('finished: still reads the true total, never the "0" a pending-only derivation would show once sending drains to zero', () => {
    const stats = { by_status: { pending: 0, sending: 0, sent: 3624, failed: 0, suppressed: 688 } };
    expect(campaignTargetCount(stats, '2026-09-07T00:00:00Z')).toBe(3624);
  });

  it('returns null — not a stale number — when preparedAt is null even though old stats are still present', () => {
    // The failure scenario final-review.md's Important-1 describes: an
    // audience got attached/detached after the last build, resetting
    // prepared_at to null WITHOUT deleting the old recipient rows, so
    // campaign_stats keeps returning the pre-reset numbers.
    const staleStats = { by_status: { pending: 4312 } };
    expect(campaignTargetCount(staleStats, null)).toBeNull();
  });
});
