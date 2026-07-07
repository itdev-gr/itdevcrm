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
    const { result } = renderHook(() => useSetExpenseAutopay(), {
      wrapper: ({ children }) => wrap(children),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', enabled: true, paymentMethod: 'CARD' });
    });
    expect(rpc).toHaveBeenCalledWith('set_expense_autopay', {
      p_expense_id: 'e1',
      p_enabled: true,
      p_payment_method: 'CARD',
    });
  });

  it('passes null payment method when omitted (disable path)', async () => {
    const { result } = renderHook(() => useSetExpenseAutopay(), {
      wrapper: ({ children }) => wrap(children),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', enabled: false });
    });
    expect(rpc).toHaveBeenCalledWith('set_expense_autopay', {
      p_expense_id: 'e1',
      p_enabled: false,
      p_payment_method: null,
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
