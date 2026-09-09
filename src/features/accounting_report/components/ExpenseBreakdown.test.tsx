import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@/lib/i18n';
import { ExpenseBreakdown } from './ExpenseBreakdown';
import type { LedgerRow } from '../hooks/useLedger';

vi.mock('../hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({
    data: [{ id: 'c1', key: 'software', name_el: 'Λογισμικό', name_en: 'Software' }],
  }),
}));

function row(overrides: Partial<LedgerRow>): LedgerRow {
  return {
    direction: 'out',
    event_date: '2026-09-05',
    period: '2026-09',
    status: 'paid',
    amount_net: 0,
    vat_amount: 0,
    amount_gross: 0,
    category_key: 'software',
    counterparty: 'Vendor',
    billing_type: 'recurring_monthly',
    source_table: 'expenses',
    source_id: Math.random().toString(36).slice(2),
    deal_id: null,
    deal_code: null,
    ...overrides,
  };
}

describe('ExpenseBreakdown', () => {
  it('includes pending rows the caller passed — no second paid-only filter', () => {
    // Report audit 2026-09-09, finding 4b: an internal status==='paid' guard
    // silently dropped the pending rows the page toggle already included,
    // freezing this table while the KPIs moved.
    render(
      <ExpenseBreakdown
        rows={[
          row({ status: 'paid', amount_net: 100, amount_gross: 124 }),
          row({ status: 'pending', amount_net: 50, amount_gross: 62 }),
        ]}
        onSelectGroup={() => {}}
        onNewExpense={() => {}}
      />,
    );
    expect(screen.getByText('€150.00')).toBeInTheDocument();
    expect(screen.getByText('€186.00')).toBeInTheDocument();
  });

  it('still ignores rows of the wrong direction', () => {
    render(
      <ExpenseBreakdown
        rows={[
          row({ amount_net: 100, amount_gross: 124 }),
          row({ direction: 'in', amount_net: 999, amount_gross: 999 }),
        ]}
        onSelectGroup={() => {}}
        onNewExpense={() => {}}
      />,
    );
    expect(screen.getByText('€100.00')).toBeInTheDocument();
    expect(screen.queryByText('€999.00')).not.toBeInTheDocument();
  });
});
