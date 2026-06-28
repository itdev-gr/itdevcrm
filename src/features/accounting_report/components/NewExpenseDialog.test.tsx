import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('../hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({
    data: [{ id: 'cat-1', name_en: 'Software', name_el: 'Λογισμικό' }],
  }),
}));
vi.mock('../hooks/useCreateExpense', () => ({
  useCreateExpense: () => ({ mutateAsync, isPending: false }),
}));

import { NewExpenseDialog } from './NewExpenseDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-1' } });
  fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-06-01' } });
}

describe('NewExpenseDialog — Save & mark paid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('blocks "Save & mark paid" when payment method is empty (DB requires it)', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    // payment method left blank
    fireEvent.click(screen.getByRole('button', { name: 'Save & mark paid' }));

    // It must NOT attempt the insert (would 400 on expenses_paid_requires_method).
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('allows "Save & mark paid" once a payment method is provided', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Bank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & mark paid' }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ markPaid: true, paymentMethod: 'Bank' }),
    );
  });

  it('still allows pending "Save" without a payment method', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ markPaid: false }));
  });
});

describe('NewExpenseDialog — monthly auto end-date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('lands on the last day of the target month for a month-end start (no overflow)', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    // Switch to a monthly billing period, then pick a month-end start date.
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-01-31' } });

    // Jan 31 + 1 month must clamp to Feb 28, not overflow into March.
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-02-28');
  });
});
