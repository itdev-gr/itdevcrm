import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { ExpensesSummaryBar } from './ExpensesSummaryBar';
import type { ExpenseListRow } from '../hooks/useExpenses';

function row(overrides: Partial<ExpenseListRow>): ExpenseListRow {
  return {
    id: Math.random().toString(36).slice(2),
    category_id: 'cat-1',
    vendor: 'V',
    billing_type: 'one_time',
    amount_net: 0,
    vat_rate: 0,
    vat_amount: 0,
    amount_gross: 0,
    start_date: '2026-07-01',
    end_date: null,
    status: 'pending',
    payment_method: null,
    paid_at: null,
    paid_by: null,
    notes: null,
    receipt_path: null,
    parent_expense_id: null,
    autopay: false,
    created_by: null,
    created_at: '2026-07-07T00:00:00Z',
    category: null,
    ...overrides,
  };
}

describe('ExpensesSummaryBar', () => {
  it('sums net, vat, gross and splits pending vs paid', () => {
    const rows = [
      row({ amount_net: 100, vat_amount: 24, amount_gross: 124, status: 'pending' }),
      row({ amount_net: 50, vat_amount: 12, amount_gross: 62, status: 'paid' }),
      row({ amount_net: 50, vat_amount: 0, amount_gross: 50, status: 'paid' }),
    ];
    render(<ExpensesSummaryBar rows={rows} />);
    expect(screen.getByTestId('summary-count').textContent).toBe('3');
    expect(screen.getByTestId('summary-net').textContent).toBe('€200.00');
    expect(screen.getByTestId('summary-vat').textContent).toBe('€36.00');
    expect(screen.getByTestId('summary-gross').textContent).toBe('€236.00');
    expect(screen.getByTestId('summary-pending').textContent).toBe('€124.00');
    expect(screen.getByTestId('summary-paid').textContent).toBe('€112.00');
  });

  it('renders zeros for an empty list', () => {
    render(<ExpensesSummaryBar rows={[]} />);
    expect(screen.getByTestId('summary-count').textContent).toBe('0');
    expect(screen.getByTestId('summary-gross').textContent).toBe('€0.00');
  });
});
