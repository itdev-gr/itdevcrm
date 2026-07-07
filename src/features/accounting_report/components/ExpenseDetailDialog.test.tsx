import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { autopayMutateAsync, detailData } = vi.hoisted(() => ({
  autopayMutateAsync: vi.fn(),
  detailData: { current: null as Record<string, unknown> | null },
}));

vi.mock('../hooks/useExpenseDetail', () => ({
  useExpenseDetail: () => ({ data: detailData.current, isLoading: false }),
}));
vi.mock('../hooks/useMarkExpensePaid', () => ({
  useMarkExpensePaid: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/useDeleteExpense', () => ({
  useDeleteExpense: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/useUploadReceipt', () => ({
  useUploadReceipt: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/useSetExpenseAutopay', () => ({
  useSetExpenseAutopay: () => ({ mutateAsync: autopayMutateAsync, isPending: false }),
}));

import { ExpenseDetailDialog } from './ExpenseDetailDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function baseExpense(overrides: Record<string, unknown> = {}) {
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

describe('ExpenseDetailDialog — Autopay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autopayMutateAsync.mockResolvedValue(1);
  });

  it('hides the autopay section for one_time expenses', () => {
    detailData.current = baseExpense({ billing_type: 'one_time' });
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    expect(screen.queryByText('Enable autopay')).toBeNull();
    expect(screen.queryByText('Disable autopay')).toBeNull();
  });

  it('enables autopay via RPC when the row already has a payment method', () => {
    detailData.current = baseExpense();
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Enable autopay' }));
    expect(autopayMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      enabled: true,
      paymentMethod: null,
    });
  });

  it('asks for a payment method first when the row has none', () => {
    detailData.current = baseExpense({ payment_method: null });
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Enable autopay' }));
    // no method typed yet -> no RPC call, an input appears instead
    expect(autopayMutateAsync).not.toHaveBeenCalled();
    const input = screen.getByLabelText('Autopay payment method');
    fireEvent.change(input, { target: { value: 'CARD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable autopay' }));
    expect(autopayMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      enabled: true,
      paymentMethod: 'CARD',
    });
  });

  it('shows Disable for an autopay expense and calls the RPC', () => {
    detailData.current = baseExpense({ autopay: true });
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Disable autopay' }));
    expect(autopayMutateAsync).toHaveBeenCalledWith({ id: 'e1', enabled: false });
  });
});
