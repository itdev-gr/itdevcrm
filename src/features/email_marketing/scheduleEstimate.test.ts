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
  // early) division-only estimate. Neither passes `warmupStartedOn`, so both
  // exercise the "not started yet" branch (see the two tests further below
  // for the "already started" branch). ---

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

  it('Case B — 10,000 recipients, campaign cap raised to 2,000, warm-up NOT started yet: assumes warm-up begins today (matching what campaign_launch will actually do), finishing Tue 15 Sep 2026 — not the naive ceil(10000/2000)=5-day estimate', () => {
    const result = estimateCampaignCompletion(
      10_000,
      { dailyCap: 2000, sendDays: WEEKDAYS, warmupLadder: DEFAULT_WARMUP_LADDER, warmupStartedOn: null },
      now,
    );
    expect(result).not.toBeNull();
    expect(result!.date.toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  // --- Second fix-pass (task-4-review-2.md): the ladder can also already be
  // mid-climb — `warmup_started_on` was set by an earlier campaign's launch
  // (20260907280000_warmup_starts_on_first_launch.sql). Both real states
  // must be modeled honestly, not just "assume it starts today" always. ---

  it('warm-up already started 10 days ago: the ladder has already reached its higher rungs, finishing much sooner than the "not started yet" assumption above — Fri 11 Sep 2026, not Tue 15 Sep', () => {
    const startedOn = new Date(now.getTime());
    startedOn.setDate(startedOn.getDate() - 10);

    const result = estimateCampaignCompletion(
      10_000,
      { dailyCap: 2000, sendDays: WEEKDAYS, warmupLadder: DEFAULT_WARMUP_LADDER, warmupStartedOn: startedOn },
      now,
    );
    expect(result).not.toBeNull();
    // 10 days in, ladder index is already clamped at the last rung (10000),
    // so `min(ladder[idx], dailyCap)` = the full 2,000/day cap from day one:
    // ceil(10000/2000) = 5 send-days, and Mon 7 Sep – Fri 11 Sep has no
    // weekend to skip.
    expect(result!.date.toISOString().slice(0, 10)).toBe('2026-09-11');
    expect(result!.days).toBe(5);
  });

  it('warm-up already started, but only 1 day ago: the ladder is still climbing, not yet saturated by the cap', () => {
    const startedOn = new Date(now.getTime());
    startedOn.setDate(startedOn.getDate() - 1);

    const result = estimateCampaignCompletion(
      3_000,
      { dailyCap: 5000, sendDays: WEEKDAYS, warmupLadder: DEFAULT_WARMUP_LADDER, warmupStartedOn: startedOn },
      now,
    );
    // Today (offset 0) is 1 calendar day since warm-up started → ladder
    // index 1 → 1,000, clamped to the 5,000 cap → allowance 1,000. Still
    // short of 3,000, so it is NOT same-day despite a cap far above the
    // target — the ladder, not the cap, is the binding constraint here.
    expect(result!.days).toBeGreaterThan(1);
  });

  // warmup_enabled=false (20260911140000): the ladder is skipped entirely and
  // every send-day is worth the full cap — the owner's "send what I tell it".
  it('ignores the warm-up ladder when the campaign opted out of the ramp', () => {
    const now = new Date(2026, 8, 14); // Monday
    const laddered = estimateCampaignCompletion(
      4000,
      { dailyCap: 2000, sendDays: WEEKDAYS, warmupLadder: DEFAULT_WARMUP_LADDER, warmupStartedOn: now },
      now,
    );
    const flat = estimateCampaignCompletion(
      4000,
      {
        dailyCap: 2000,
        sendDays: WEEKDAYS,
        warmupLadder: DEFAULT_WARMUP_LADDER,
        warmupStartedOn: now,
        warmupEnabled: false,
      },
      now,
    );
    // Ladder rungs 500 then 1000 leave 2500 for day 3; a flat 2000/day is done on day 2.
    expect(flat!.days).toBe(2);
    expect(laddered!.days).toBeGreaterThan(flat!.days);
  });
});
