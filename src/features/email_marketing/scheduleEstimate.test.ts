import { describe, it, expect } from 'vitest';
import { estimateCampaignCompletion, DEFAULT_DAILY_CAP, DEFAULT_WARMUP_LADDER } from './scheduleEstimate';

const WEEKDAYS = [1, 2, 3, 4, 5];

describe('estimateCampaignCompletion', () => {
  // Monday 2026-09-07, 10:00 UTC — a safe mid-day timestamp so weekday
  // arithmetic can't roll over across a timezone boundary.
  const now = new Date('2026-09-07T10:00:00Z');

  it('a cap larger than the whole audience finishes the same day', () => {
    const result = estimateCampaignCompletion(300, { dailyCap: 500, sendDays: WEEKDAYS }, now);
    expect(result).not.toBeNull();
    expect(result!.days).toBe(1);
    expect(result!.date.toDateString()).toBe(now.toDateString());
  });

  it('a cap exactly equal to the audience also finishes the same day', () => {
    const result = estimateCampaignCompletion(500, { dailyCap: 500, sendDays: WEEKDAYS }, now);
    expect(result!.days).toBe(1);
    expect(result!.date.toDateString()).toBe(now.toDateString());
  });

  it('a zero target yields no estimate rather than a nonsense date', () => {
    expect(estimateCampaignCompletion(0, { dailyCap: 500, sendDays: WEEKDAYS }, now)).toBeNull();
  });

  it('a negative target yields no estimate', () => {
    expect(estimateCampaignCompletion(-10, { dailyCap: 500, sendDays: WEEKDAYS }, now)).toBeNull();
  });

  it('a non-positive cap yields no estimate rather than dividing by zero', () => {
    expect(estimateCampaignCompletion(1000, { dailyCap: 0, sendDays: WEEKDAYS }, now)).toBeNull();
    expect(estimateCampaignCompletion(1000, { dailyCap: -5, sendDays: WEEKDAYS }, now)).toBeNull();
  });

  it('a non-finite input yields no estimate', () => {
    expect(estimateCampaignCompletion(NaN, { dailyCap: 500, sendDays: WEEKDAYS }, now)).toBeNull();
    expect(estimateCampaignCompletion(1000, { dailyCap: NaN, sendDays: WEEKDAYS }, now)).toBeNull();
  });

  it('no allowed send days yields no estimate — sending can never happen', () => {
    expect(estimateCampaignCompletion(1000, { dailyCap: 500, sendDays: [] }, now)).toBeNull();
  });

  it('an empty warm-up ladder falls back to the platform default rather than crashing', () => {
    const result = estimateCampaignCompletion(300, { dailyCap: 500, sendDays: WEEKDAYS, warmupLadder: [] }, now);
    expect(result!.days).toBe(1);
  });

  it('skips non-send-days when walking forward — weekend excluded for a weekday-only campaign', () => {
    // Cap covers 1 day's worth alone but not 2 — with weekdays-only sending
    // and the ladder saturating immediately (cap === first rung), day 2 of
    // sending is the next weekday, skipping the weekend if one falls between.
    // Friday 2026-09-11 start: day 1 = Fri, day 2 = Mon (skips Sat/Sun).
    const friday = new Date('2026-09-11T10:00:00Z');
    const result = estimateCampaignCompletion(600, { dailyCap: 500, sendDays: WEEKDAYS }, friday);
    expect(result!.days).toBe(4); // Fri(1), Sat(skip), Sun(skip), Mon(2nd send day) = day offset 3 → days=4
    expect(result!.date.getDay()).toBe(1); // Monday (local weekday, matching the implementation's own local Date methods)
  });

  // --- Two worked examples pinned from task-4-review.md's Case A/B, using
  // the shipped schema defaults (daily_cap 500, warmup_ladder
  // {500,1000,2000,3000,5000,7500,10000}) and weekdays-only sending. Both
  // reproduce the review's own hand-worked arithmetic exactly, so this
  // arithmetic cannot silently drift back to the flat (and misleadingly
  // early) division-only estimate. ---

  it('Case A — 10,000 recipients, campaign cap unset (falls back to the 500 default): 20 send-days, weekdays only, finishes Fri 2 Oct 2026 — not the naive ceil(10000/500)=20-CALENDAR-day estimate', () => {
    const result = estimateCampaignCompletion(
      10_000,
      { dailyCap: DEFAULT_DAILY_CAP, sendDays: WEEKDAYS, warmupLadder: DEFAULT_WARMUP_LADDER },
      now,
    );
    expect(result).not.toBeNull();
    expect(result!.date.toISOString().slice(0, 10)).toBe('2026-10-02');
    expect(result!.days).toBe(26); // 26 calendar days from Mon 7 Sep to Fri 2 Oct, inclusive
  });

  it('Case B — 10,000 recipients, campaign cap raised to 2,000: the warm-up ladder (not the cap) governs the first few days, finishing Tue 15 Sep 2026 — not the naive ceil(10000/2000)=5-day estimate', () => {
    const result = estimateCampaignCompletion(
      10_000,
      { dailyCap: 2000, sendDays: WEEKDAYS, warmupLadder: DEFAULT_WARMUP_LADDER },
      now,
    );
    expect(result).not.toBeNull();
    expect(result!.date.toISOString().slice(0, 10)).toBe('2026-09-15');
  });
});
