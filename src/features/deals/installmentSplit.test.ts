import { describe, it, expect } from 'vitest';
import { splitInstallments, planCount, type InstallmentPlan } from './installmentSplit';

describe('splitInstallments', () => {
  it('returns the full amount as a single part for "none"', () => {
    expect(splitInstallments(1000, 'none')).toEqual([1000]);
  });

  it('splits 50/50 into two equal halves', () => {
    expect(splitInstallments(1000, '50_50')).toEqual([500, 500]);
  });

  it('splits 50/25/25 into deposit + two quarters', () => {
    expect(splitInstallments(1000, '50_25_25')).toEqual([500, 250, 250]);
  });

  it('keeps the parts summing exactly to the total, last part absorbs the cent remainder', () => {
    const parts = splitInstallments(333.33, '50_25_25');
    expect(parts).toEqual([166.67, 83.33, 83.33]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(333.33, 10);
  });

  it('rounds half away from zero (cents-based, no float drift) for 50/50', () => {
    // 100.01 → deposit round(50.005)=50.01, balance = 50.00 (sums to 100.01)
    const parts = splitInstallments(100.01, '50_50');
    expect(parts).toEqual([50.01, 50]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(100.01, 10);
  });

  it('handles a tiny amount without losing a cent', () => {
    const parts = splitInstallments(0.01, '50_50');
    expect(parts).toEqual([0.01, 0]);
  });

  it('treats a zero amount as all-zero parts', () => {
    expect(splitInstallments(0, '50_25_25')).toEqual([0, 0, 0]);
  });

  it('planCount reports how many payments a plan produces', () => {
    expect(planCount('none')).toBe(1);
    expect(planCount('50_50')).toBe(2);
    expect(planCount('50_25_25')).toBe(3);
  });

  it('exposes the plan type for callers', () => {
    const p: InstallmentPlan = '50_50';
    expect(planCount(p)).toBe(2);
  });
});
