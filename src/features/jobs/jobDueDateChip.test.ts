import { describe, it, expect } from 'vitest';
import { formatJobDueDateChip } from './jobDueDateChip';

const today = new Date('2026-07-01T00:00:00Z');

describe('formatJobDueDateChip', () => {
  it('returns null when due is missing', () => {
    expect(formatJobDueDateChip({ due: null, completed: false }, today, 'en')).toBeNull();
    expect(formatJobDueDateChip({ due: undefined, completed: false }, today, 'en')).toBeNull();
    expect(formatJobDueDateChip({ due: '', completed: false }, today, 'en')).toBeNull();
  });

  it('returns null for an unparsable date', () => {
    expect(formatJobDueDateChip({ due: 'not-a-date', completed: false }, today, 'en')).toBeNull();
  });

  it('formats a far-future due date as DD/MM with tone=ok', () => {
    const r = formatJobDueDateChip({ due: '2026-08-15', completed: false }, today, 'en');
    expect(r).not.toBeNull();
    expect(r!.label).toBe('15/08');
    expect(r!.tone).toBe('ok');
    expect(r!.tooltip).toBe('Delivery due 15/08/2026');
  });

  it('localizes the tooltip in Greek', () => {
    const r = formatJobDueDateChip({ due: '2026-08-15', completed: false }, today, 'el');
    expect(r!.tooltip).toBe('Παράδοση έως 15/08/2026');
  });

  it('uses tone=due-soon when 0..7 days remain', () => {
    expect(formatJobDueDateChip({ due: '2026-07-08', completed: false }, today, 'en')!.tone).toBe('due-soon');
    expect(formatJobDueDateChip({ due: '2026-07-01', completed: false }, today, 'en')!.tone).toBe('due-soon');
  });

  it('uses tone=ok at exactly 8 days out', () => {
    expect(formatJobDueDateChip({ due: '2026-07-09', completed: false }, today, 'en')!.tone).toBe('ok');
  });

  it('uses tone=overdue when the due date is in the past', () => {
    expect(formatJobDueDateChip({ due: '2026-06-25', completed: false }, today, 'en')!.tone).toBe('overdue');
  });

  it('suppresses urgency on completed jobs (tone=ok, chip still shown)', () => {
    const r = formatJobDueDateChip({ due: '2026-06-25', completed: true }, today, 'en');
    expect(r!.tone).toBe('ok');
    expect(r!.label).toBe('25/06');
  });
});
