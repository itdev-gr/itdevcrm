import { describe, it, expect } from 'vitest';
import type { DealPaymentRow } from './hooks/useDealPayments';
import {
  currentMonthKey,
  groupPaymentsByMonth,
  monthKeyOf,
  NO_PERIOD_KEY,
  rowGross,
} from './paymentMonths';

function makeRow(over: Partial<DealPaymentRow>): DealPaymentRow {
  return {
    id: 'x',
    deal_id: 'd1',
    amount_gross: 124,
    amount_net: 100,
    billing_type: 'recurring_monthly',
    created_at: '2026-01-01T00:00:00Z',
    end_date: null,
    invoice_number: null,
    label: null,
    paid_at: null,
    service_index: 0,
    service_type: 'local_seo',
    start_date: '2026-07-01',
    status: 'pending',
    updated_at: '2026-01-01T00:00:00Z',
    vat_amount: 24,
    vat_rate: 24,
    ...over,
  };
}

const TODAY = '2026-08'; // fixed clock for every test

describe('monthKeyOf / currentMonthKey', () => {
  it('takes the month from start_date and falls back to the no-period key', () => {
    expect(monthKeyOf({ start_date: '2026-07-15' })).toBe('2026-07');
    expect(monthKeyOf({ start_date: null })).toBe(NO_PERIOD_KEY);
  });

  it('formats the current month with a zero-padded month number', () => {
    expect(currentMonthKey(new Date(2026, 7, 29))).toBe('2026-08');
    expect(currentMonthKey(new Date(2026, 0, 2))).toBe('2026-01');
  });
});

describe('rowGross', () => {
  it('prefers the DB generated gross when present', () => {
    expect(rowGross(makeRow({ amount_gross: 124 }))).toBe(124);
  });

  it('computes net + VAT with cents rounding when gross is missing', () => {
    expect(rowGross(makeRow({ amount_gross: null, amount_net: 33.33, vat_rate: 24 }))).toBe(41.33);
  });
});

describe('groupPaymentsByMonth', () => {
  it('sends a fully paid past month to the past archive', () => {
    const { active, past } = groupPaymentsByMonth(
      [makeRow({ id: 'a', status: 'paid', start_date: '2026-06-01' })],
      TODAY,
    );
    expect(active).toHaveLength(0);
    expect(past.map((g) => g.key)).toEqual(['2026-06']);
  });

  it('keeps a past month active while anything in it is still open', () => {
    const { active, past } = groupPaymentsByMonth(
      [
        makeRow({ id: 'a', status: 'paid', start_date: '2026-06-01' }),
        makeRow({ id: 'b', status: 'overdue', start_date: '2026-06-01' }),
      ],
      TODAY,
    );
    expect(past).toHaveLength(0);
    expect(active[0]).toMatchObject({ key: '2026-06', hasOpen: true, hasOverdue: true, paidCount: 1 });
  });

  it('keeps a fully prepaid current or future month active, not in the past archive', () => {
    const { active, past } = groupPaymentsByMonth(
      [
        makeRow({ id: 'a', status: 'paid', start_date: '2026-08-01' }),
        makeRow({ id: 'b', status: 'paid', start_date: '2026-09-01' }),
      ],
      TODAY,
    );
    expect(past).toHaveLength(0);
    expect(active.map((g) => g.key)).toEqual(['2026-08', '2026-09']);
    expect(active.every((g) => !g.hasOpen)).toBe(true);
  });

  it('treats a month with only cancelled rows as settled', () => {
    const { active, past } = groupPaymentsByMonth(
      [makeRow({ id: 'a', status: 'cancelled', start_date: '2026-05-01' })],
      TODAY,
    );
    expect(active).toHaveLength(0);
    expect(past[0]).toMatchObject({ key: '2026-05', billableCount: 0, gross: 0 });
  });

  it('excludes cancelled rows from totals and counts but keeps them in the rows', () => {
    const group = groupPaymentsByMonth(
      [
        makeRow({ id: 'a', status: 'paid', amount_gross: 100, start_date: '2026-08-01' }),
        makeRow({ id: 'b', status: 'cancelled', amount_gross: 50, start_date: '2026-08-01' }),
        makeRow({ id: 'c', status: 'pending', amount_gross: 200, start_date: '2026-08-01' }),
      ],
      TODAY,
    ).active[0]!;
    expect(group.gross).toBe(300);
    expect(group.billableCount).toBe(2);
    expect(group.paidCount).toBe(1);
    expect(group.rows).toHaveLength(3);
  });

  it('orders active months oldest-first with the no-period group last, past newest-first', () => {
    const { active, past } = groupPaymentsByMonth(
      [
        makeRow({ id: 'a', status: 'pending', start_date: null }),
        makeRow({ id: 'b', status: 'pending', start_date: '2026-09-01' }),
        makeRow({ id: 'c', status: 'overdue', start_date: '2026-07-01' }),
        makeRow({ id: 'd', status: 'paid', start_date: '2026-05-01' }),
        makeRow({ id: 'e', status: 'paid', start_date: '2026-06-01' }),
      ],
      TODAY,
    );
    expect(active.map((g) => g.key)).toEqual(['2026-07', '2026-09', NO_PERIOD_KEY]);
    expect(past.map((g) => g.key)).toEqual(['2026-06', '2026-05']);
  });

  it('never archives the no-period group even when fully paid', () => {
    const { active, past } = groupPaymentsByMonth(
      [makeRow({ id: 'a', status: 'paid', start_date: null })],
      TODAY,
    );
    expect(past).toHaveLength(0);
    expect(active.map((g) => g.key)).toEqual([NO_PERIOD_KEY]);
  });
});
