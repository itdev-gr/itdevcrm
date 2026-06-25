import { describe, it, expect } from 'vitest';
import { validateCustomSchedule, scheduleTotal, type ScheduleRow } from './customSchedule';

const rows = (xs: Array<[number, string | null]>): ScheduleRow[] =>
  xs.map(([amount_net, due_date]) => ({ amount_net, due_date }));

describe('scheduleTotal', () => {
  it('sums the parts to cents precision', () => {
    expect(scheduleTotal(rows([[400, null], [600.5, null]]))).toBe(1000.5);
  });
});

describe('validateCustomSchedule', () => {
  it('passes when non-empty and parts sum to the target', () => {
    expect(validateCustomSchedule(rows([[400, '2026-07-01'], [600, null]]), 1000)).toBeNull();
  });
  it('fails when empty', () => {
    expect(validateCustomSchedule([], 1000)).toBe('schedule_required');
  });
  it('fails when a part is zero or negative', () => {
    expect(validateCustomSchedule(rows([[0, null], [1000, null]]), 1000)).toBe('schedule_amount_positive');
  });
  it('fails when the parts do not sum to the target', () => {
    expect(validateCustomSchedule(rows([[400, null], [500, null]]), 1000)).toBe('schedule_total_mismatch');
  });
  it('tolerates sub-cent float drift', () => {
    expect(validateCustomSchedule(rows([[333.33, null], [333.33, null], [333.34, null]]), 1000)).toBeNull();
  });
});
