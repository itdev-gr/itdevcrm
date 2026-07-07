import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { updateMutateAsync } = vi.hoisted(() => ({ updateMutateAsync: vi.fn() }));

vi.mock('../hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({
    data: [
      { id: 'cat-1', name_en: 'Software', name_el: 'Λογισμικό' },
      { id: 'cat-2', name_en: 'Rent', name_el: 'Ενοίκιο' },
    ],
  }),
}));
vi.mock('../hooks/useUpdateExpense', () => ({
  useUpdateExpense: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

import { ExpenseEditForm } from './ExpenseEditForm';
import type { ExpenseListRow } from '../hooks/useExpenses';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function expense(overrides: Partial<ExpenseListRow> = {}): ExpenseListRow {
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

describe('ExpenseEditForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('prefills all fields from the expense', () => {
    render(wrap(<ExpenseEditForm expense={expense()} onDone={() => {}} />));
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('cat-1');
    expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe('COSMOTE');
    expect((screen.getByLabelText('Amount (net)') as HTMLInputElement).value).toBe('99.8');
    expect((screen.getByLabelText('VAT rate (%)') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-07-01');
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-08-01');
    expect((screen.getByLabelText('Payment method') as HTMLInputElement).value).toBe('CARD');
  });

  it('saves the edited fields via useUpdateExpense and calls onDone', async () => {
    const onDone = vi.fn();
    render(wrap(<ExpenseEditForm expense={expense()} onDone={onDone} />));
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'COSMOTE SA' } });
    fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Save' });

    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      patch: {
        vendor: 'COSMOTE SA',
        categoryId: 'cat-1',
        billingType: 'recurring_monthly',
        amountNet: 120,
        vatRate: 0,
        startDate: '2026-07-01',
        endDate: '2026-08-01',
        notes: null,
        paymentMethod: 'CARD',
      },
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('blocks save when amount is emptied', () => {
    render(wrap(<ExpenseEditForm expense={expense()} onDone={() => {}} />));
    fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Net amount is required.')).toBeTruthy();
  });

  it('blocks save when end date is before start date', () => {
    render(wrap(<ExpenseEditForm expense={expense()} onDone={() => {}} />));
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('End date must be on or after start date.')).toBeTruthy();
  });

  it('shows the chain hint for recurring expenses only', () => {
    const { unmount } = render(wrap(<ExpenseEditForm expense={expense()} onDone={() => {}} />));
    expect(screen.getByText(/Future periods copy the newest row/)).toBeTruthy();
    unmount();
    render(wrap(<ExpenseEditForm expense={expense({ billing_type: 'one_time' })} onDone={() => {}} />));
    expect(screen.queryByText(/Future periods copy the newest row/)).toBeNull();
  });

  it('cancel calls onDone without saving', () => {
    const onDone = vi.fn();
    render(wrap(<ExpenseEditForm expense={expense()} onDone={onDone} />));
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
