import { describe, it, expect } from 'vitest';
import { estimateCampaignCompletion, DEFAULT_DAILY_CAP } from './scheduleEstimate';

describe('estimateCampaignCompletion', () => {
  const now = new Date('2026-09-07T10:00:00Z');

  it('a cap larger than the whole audience finishes the same day', () => {
    const result = estimateCampaignCompletion(300, 500, now);
    expect(result).not.toBeNull();
    expect(result!.days).toBe(1);
    expect(result!.date.toDateString()).toBe(now.toDateString());
  });

  it('a cap exactly equal to the audience also finishes the same day', () => {
    const result = estimateCampaignCompletion(500, 500, now);
    expect(result!.days).toBe(1);
    expect(result!.date.toDateString()).toBe(now.toDateString());
  });

  it('a zero target yields no estimate rather than a nonsense date', () => {
    expect(estimateCampaignCompletion(0, 500, now)).toBeNull();
  });

  it('a negative target yields no estimate', () => {
    expect(estimateCampaignCompletion(-10, 500, now)).toBeNull();
  });

  it('a non-positive cap yields no estimate rather than dividing by zero', () => {
    expect(estimateCampaignCompletion(1000, 0, now)).toBeNull();
    expect(estimateCampaignCompletion(1000, -5, now)).toBeNull();
  });

  it('a non-finite input yields no estimate', () => {
    expect(estimateCampaignCompletion(NaN, 500, now)).toBeNull();
    expect(estimateCampaignCompletion(1000, NaN, now)).toBeNull();
  });

  it('rounds up to whole days — 1001 recipients at 500/day takes 3 days, not 2.002', () => {
    const result = estimateCampaignCompletion(1001, 500, now);
    expect(result!.days).toBe(3);
    const expectedDate = new Date(now);
    expectedDate.setDate(expectedDate.getDate() + 2);
    expect(result!.date.toDateString()).toBe(expectedDate.toDateString());
  });

  it('an exact multiple takes exactly that many days', () => {
    const result = estimateCampaignCompletion(1500, 500, now);
    expect(result!.days).toBe(3);
  });

  it('a large audience against the platform default cap genuinely takes days, not hours', () => {
    const result = estimateCampaignCompletion(10_000, DEFAULT_DAILY_CAP, now);
    expect(result!.days).toBe(20);
    expect(result!.days).toBeGreaterThan(1);
  });
});
