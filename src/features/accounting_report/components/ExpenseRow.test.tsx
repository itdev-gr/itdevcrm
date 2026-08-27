import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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

describe('ExpenseRow — bulk mark-paid selection checkbox', () => {
  it('does not render a checkbox column when onToggleSelect is not passed', () => {
    renderRow(row());
    expect(screen.queryByLabelText('Select row')).toBeNull();
  });

  it('shows a checkbox for pending rows and calls onToggleSelect on change', () => {
    const onToggleSelect = vi.fn();
    render(
      <table>
        <tbody>
          <ExpenseRow row={row({ status: 'pending' })} onClick={() => {}} onToggleSelect={onToggleSelect} />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByLabelText('Select row'));
    expect(onToggleSelect).toHaveBeenCalledWith('e1');
  });

  it('hides the checkbox for already-paid rows', () => {
    render(
      <table>
        <tbody>
          <ExpenseRow row={row({ status: 'paid' })} onClick={() => {}} onToggleSelect={vi.fn()} />
        </tbody>
      </table>,
    );
    expect(screen.queryByLabelText('Select row')).toBeNull();
  });

  it('clicking the checkbox does not also open the row detail dialog', () => {
    const onClick = vi.fn();
    render(
      <table>
        <tbody>
          <ExpenseRow row={row({ status: 'pending' })} onClick={onClick} onToggleSelect={vi.fn()} />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByLabelText('Select row'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
