import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}));

import { useSetExpenseAutopay } from './useSetExpenseAutopay';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useSetExpenseAutopay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: 1, error: null });
  });

  it('calls set_expense_autopay with id, enabled, and payment method', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSetExpenseAutopay(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', enabled: true, paymentMethod: 'CARD' });
    });
    expect(rpc).toHaveBeenCalledWith('set_expense_autopay', {
      p_expense_id: 'e1',
      p_enabled: true,
      p_payment_method: 'CARD',
    });
    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['dashboard-monthly-pl']));
  });

  it('omits the payment method when not provided (disable path)', async () => {
    const { result } = renderHook(() => useSetExpenseAutopay(), {
      wrapper: ({ children }) => wrap(children),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', enabled: false });
    });
    // Regenerated RPC types take an optional arg: the key is omitted and the
    // server default (null) applies, same behavior as the old explicit null.
    expect(rpc).toHaveBeenCalledWith('set_expense_autopay', {
      p_expense_id: 'e1',
      p_enabled: false,
    });
  });

  it('surfaces RPC errors (e.g. missing payment method) as a rejection', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'payment method required to enable autopay' },
    });
    const { result } = renderHook(() => useSetExpenseAutopay(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: 'e1', enabled: true });
      }),
    ).rejects.toThrow('payment method required to enable autopay');
  });
});
