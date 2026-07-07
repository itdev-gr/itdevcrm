import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { ExpenseRow } from './ExpenseRow';
import type { ExpenseListRow } from '../hooks/useExpenses';

function row(overrides: Partial<ExpenseListRow> = {}): ExpenseListRow {
  return {
    id: 'e1',
    category_id: 'cat-1',
    vendor: 'COSMOTE',
    billing_type: 'recurring_monthly',
    amount_net: 99.8,
    vat_rate: 0,
    vat_amount: 0,
    amount_gross: 99.8,
    start_date: '2026-07-01',
    end_date: '2026-08-01',
    status: 'pending',
    payment_method: 'CARD',
    paid_at: null,
    paid_by: null,
    notes: null,
    receipt_path: null,
    parent_expense_id: null,
    autopay: false,
    created_by: null,
    created_at: '2026-07-07T00:00:00Z',
    category: { key: 'software', name_en: 'Software', name_el: 'Λογισμικό' },
    ...overrides,
  };
}

function renderRow(r: ExpenseListRow) {
  return render(
    <table>
      <tbody>
        <ExpenseRow row={r} onClick={() => {}} />
      </tbody>
    </table>,
  );
}

describe('ExpenseRow — autopay badge', () => {
  it('shows the Autopay badge when autopay is on', () => {
    renderRow(row({ autopay: true }));
    expect(screen.getByText(/Autopay/)).toBeTruthy();
  });

  it('hides the badge when autopay is off', () => {
    renderRow(row());
    expect(screen.queryByText(/Autopay/)).toBeNull();
  });
});
