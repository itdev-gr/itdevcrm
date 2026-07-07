import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, insert, from } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  return { single, insert, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useCreateExpense } from './useCreateExpense';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useCreateExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'e1' }, error: null });
  });

  it('inserts pending row with correct payload', async () => {
    const { result } = renderHook(() => useCreateExpense(), {
      wrapper: ({ children }) => wrap(children),
    });
    await act(async () => {
      await result.current.mutateAsync({
        categoryId: 'cat-1',
        vendor: 'Adobe',
        billingType: 'recurring_monthly',
        amountNet: 100,
        vatRate: 24,
        startDate: '2026-06-01',
        endDate: '2026-07-01',
        paymentMethod: 'card',
        notes: 'CC',
      });
    });
    expect(insert).toHaveBeenCalledWith({
      category_id: 'cat-1',
      vendor: 'Adobe',
      billing_type: 'recurring_monthly',
      amount_net: 100,
      vat_rate: 24,
      start_date: '2026-06-01',
      end_date: '2026-07-01',
      payment_method: 'card',
      notes: 'CC',
      paid_by: null,
      paid_at: null,
      status: 'pending',
      autopay: false,
    });
  });

  it('supports markPaid=true with paid_by and paid_at', async () => {
    const { result } = renderHook(() => useCreateExpense(), {
      wrapper: ({ children }) => wrap(children),
    });
    await act(async () => {
      await result.current.mutateAsync({
        categoryId: 'cat-1',
        billingType: 'one_time',
        amountNet: 50,
        vatRate: 24,
        startDate: '2026-06-01',
        paymentMethod: 'cash',
        markPaid: true,
        paidByUserId: 'user-1',
      });
    });
    const payload = insert.mock.calls[0]![0];
    expect(payload.status).toBe('paid');
    expect(payload.payment_method).toBe('cash');
    expect(payload.paid_by).toBe('user-1');
    expect(typeof payload.paid_at).toBe('string');
  });
});
