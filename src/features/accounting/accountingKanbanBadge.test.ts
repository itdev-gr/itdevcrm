import { describe, expect, it } from 'vitest';
import { paidBadge } from './accountingKanbanBadge';

describe('paidBadge', () => {
  it('is fully paid when the only non-cancelled rows are all paid (audit B11/F28)', () => {
    // 2 paid + 1 cancelled must read "Paid", not "Partial" — cancelled rows
    // were never going to be paid and must not count against the total.
    const result = paidBadge([
      { status: 'paid' },
      { status: 'paid' },
      { status: 'cancelled' },
    ]);
    expect(result).toEqual({ paid: 2, total: 2, label: 'paid' });
  });

  it('shows the same "no payments" state when every row is cancelled', () => {
    // Matches what the card shows for an empty payments list today: no
    // countable payments at all still reads as 'pending'.
    const result = paidBadge([
      { status: 'cancelled' },
      { status: 'cancelled' },
    ]);
    expect(result).toEqual({ paid: 0, total: 0, label: 'pending' });
  });

  it('is pending when there are no payments at all', () => {
    expect(paidBadge([])).toEqual({ paid: 0, total: 0, label: 'pending' });
  });

  it('is pending when countable payments exist but none are paid', () => {
    const result = paidBadge([{ status: 'pending' }, { status: 'overdue' }]);
    expect(result).toEqual({ paid: 0, total: 2, label: 'pending' });
  });

  it('is partial when some but not all countable payments are paid', () => {
    const result = paidBadge([
      { status: 'paid' },
      { status: 'pending' },
      { status: 'cancelled' },
    ]);
    expect(result).toEqual({ paid: 1, total: 2, label: 'partial' });
  });

  it('is paid when every countable payment is paid and none are cancelled', () => {
    const result = paidBadge([{ status: 'paid' }, { status: 'paid' }]);
    expect(result).toEqual({ paid: 2, total: 2, label: 'paid' });
  });
});
