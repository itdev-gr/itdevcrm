import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, eq, update, from, getUser } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  return { single, eq, update, from, getUser };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from, auth: { getUser } },
}));

import { useMarkExpensePaid } from './useMarkExpensePaid';

describe('useMarkExpensePaid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'e1' }, error: null });
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('sets status=paid, paid_at=now, payment_method, paid_by=currentUser', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useMarkExpensePaid(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', paymentMethod: 'bank_transfer' });
    });
    const payload = update.mock.calls[0]![0];
    expect(payload.status).toBe('paid');
    expect(payload.payment_method).toBe('bank_transfer');
    expect(payload.paid_by).toBe('user-1');
    expect(typeof payload.paid_at).toBe('string');
    expect(eq).toHaveBeenCalledWith('id', 'e1');
    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['dashboard-monthly-pl']));
  });

  it('carries the chosen paidDate as paid_at at midnight UTC', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useMarkExpensePaid(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'e1',
        paymentMethod: 'cash',
        paidDate: '2026-08-20',
      });
    });
    const payload = update.mock.calls[0]![0];
    expect(payload.paid_at).toBe('2026-08-20T00:00:00Z');
  });

  it('defaults paidDate to today when omitted', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useMarkExpensePaid(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', paymentMethod: 'cash' });
    });
    const payload = update.mock.calls[0]![0];
    const today = new Date().toISOString().slice(0, 10);
    expect(payload.paid_at).toBe(`${today}T00:00:00Z`);
  });
});
