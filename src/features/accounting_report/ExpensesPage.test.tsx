import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import type { ExpenseListRow } from './hooks/useExpenses';

const { markPaidMutateAsync, expensesData } = vi.hoisted(() => ({
  markPaidMutateAsync: vi.fn(),
  expensesData: { current: [] as ExpenseListRow[] },
}));

vi.mock('./hooks/useExpenses', () => ({
  useExpenses: () => ({ data: expensesData.current, isLoading: false }),
}));
vi.mock('./hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({ data: [] }),
}));
vi.mock('./hooks/useExpensesRealtime', () => ({
  useExpensesRealtime: () => {},
}));
vi.mock('./hooks/useMarkExpensePaid', () => ({
  useMarkExpensePaid: () => ({ mutateAsync: markPaidMutateAsync }),
}));
vi.mock('./components/ExpenseDetailDialog', () => ({
  ExpenseDetailDialog: () => null,
}));
vi.mock('./components/NewExpenseDialog', () => ({
  NewExpenseDialog: () => null,
}));

import { ExpensesPage } from './ExpensesPage';

function row(overrides: Partial<ExpenseListRow> = {}): ExpenseListRow {
  return {
    id: 'e1',
    category_id: 'cat-1',
    vendor: 'COSMOTE',
    billing_type: 'one_time',
    amount_net: 100,
    vat_rate: 24,
    vat_amount: 24,
    amount_gross: 124,
    start_date: '2026-08-01',
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
    created_at: '2026-08-01T00:00:00Z',
    category: { key: 'software', name_en: 'Software', name_el: 'Λογισμικό' },
    ...overrides,
  };
}

describe('ExpensesPage — bulk mark paid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markPaidMutateAsync.mockResolvedValue({});
    expensesData.current = [row({ id: 'e1' }), row({ id: 'e2' })];
  });

  it('shows no bulk bar until a row is selected', () => {
    render(<ExpensesPage />);
    expect(screen.queryByText('Mark selected paid')).toBeNull();
  });

  it('selecting rows reveals the bulk-mark-paid action with a date input', () => {
    render(<ExpensesPage />);
    const checkboxes = screen.getAllByLabelText('Select row');
    fireEvent.click(checkboxes[0]!);

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark selected paid' }));

    const dateInput = screen.getByLabelText('Payment date') as HTMLInputElement;
    const today = new Date().toISOString().slice(0, 10);
    expect(dateInput.value).toBe(today);
  });

  it('applies one chosen payment method + date to every selected row', async () => {
    render(<ExpensesPage />);
    const checkboxes = screen.getAllByLabelText('Select row');
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    fireEvent.click(screen.getByRole('button', { name: 'Mark selected paid' }));
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'bank_transfer' } });
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-08-10' } });

    // Two "Mark selected paid" labels exist now: the trigger + the popover submit button.
    const submitButtons = screen.getAllByRole('button', { name: 'Mark selected paid' });
    fireEvent.click(submitButtons[submitButtons.length - 1]!);

    await waitFor(() => expect(markPaidMutateAsync).toHaveBeenCalledTimes(2));
    expect(markPaidMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      paymentMethod: 'bank_transfer',
      paidDate: '2026-08-10',
    });
    expect(markPaidMutateAsync).toHaveBeenCalledWith({
      id: 'e2',
      paymentMethod: 'bank_transfer',
      paidDate: '2026-08-10',
    });
  });

  it('does not offer a checkbox for already-paid rows', () => {
    expensesData.current = [row({ id: 'e1', status: 'paid' })];
    render(<ExpensesPage />);
    expect(screen.queryByLabelText('Select row')).toBeNull();
  });
});
