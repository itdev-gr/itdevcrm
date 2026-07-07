import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { mutateAsync, autopayMutateAsync } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  autopayMutateAsync: vi.fn(),
}));

vi.mock('../hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({
    data: [{ id: 'cat-1', name_en: 'Software', name_el: 'Λογισμικό' }],
  }),
}));
vi.mock('../hooks/useCreateExpense', () => ({
  useCreateExpense: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('../hooks/useSetExpenseAutopay', () => ({
  useSetExpenseAutopay: () => ({ mutateAsync: autopayMutateAsync, isPending: false }),
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

describe('NewExpenseDialog — Autopay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
    autopayMutateAsync.mockResolvedValue(1);
  });

  it('hides the autopay toggle for one_time billing', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    expect(screen.queryByLabelText('Autopay')).toBeNull();
  });

  it('shows the autopay toggle for recurring billing', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByLabelText('Autopay')).toBeTruthy();
  });

  it('blocks Save when autopay is on but payment method is empty', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByLabelText('Autopay'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('A payment method is required for autopay')).toBeTruthy();
  });

  it('creates with autopay=true and settles via RPC when method provided', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByLabelText('Autopay'));
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'CARD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('button', { name: 'Save' }); // let async submit settle
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ autopay: true }));
    expect(autopayMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      enabled: true,
      paymentMethod: 'CARD',
    });
  });

  it('switching back to one_time drops autopay from the payload', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByLabelText('Autopay'));
    fireEvent.click(screen.getByRole('button', { name: 'One-time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ autopay: false }));
    expect(autopayMutateAsync).not.toHaveBeenCalled();
  });
});
