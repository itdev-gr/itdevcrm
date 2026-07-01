import { describe, it, expect } from 'vitest';
import { formatJobPeriodChip } from './jobPeriodChip';

const today = new Date('2026-07-01T00:00:00Z');

describe('formatJobPeriodChip', () => {
  it('returns null when both dates are missing', () => {
    expect(formatJobPeriodChip({ start: null, due: null }, today)).toBeNull();
  });

  it('returns null when only start_date is set (no coverage yet)', () => {
    expect(formatJobPeriodChip({ start: '2026-06-01', due: null }, today)).toBeNull();
  });

  it('formats a future due date as "Due DD/MM" with tone=ok when >7 days out', () => {
    const r = formatJobPeriodChip({ start: '2026-06-15', due: '2026-07-15' }, today);
    expect(r).not.toBeNull();
    expect(r!.label).toBe('Due 15/07');
    expect(r!.tone).toBe('ok');
  });

  it('uses tone=due-soon when 0..7 days remain', () => {
    const r = formatJobPeriodChip({ start: '2026-06-05', due: '2026-07-05' }, today);
    expect(r!.tone).toBe('due-soon');
  });

  it('uses tone=due-soon on the due day itself', () => {
    const r = formatJobPeriodChip({ start: '2026-06-01', due: '2026-07-01' }, today);
    expect(r!.tone).toBe('due-soon');
  });

  it('uses tone=overdue when due_date is in the past', () => {
    const r = formatJobPeriodChip({ start: '2026-05-25', due: '2026-06-25' }, today);
    expect(r!.tone).toBe('overdue');
  });
});
