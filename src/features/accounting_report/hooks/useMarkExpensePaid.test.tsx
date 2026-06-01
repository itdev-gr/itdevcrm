import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, select, eq, update, from, getUser } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  return { single, select, eq, update, from, getUser };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from, auth: { getUser } },
}));

import { useMarkExpensePaid } from './useMarkExpensePaid';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useMarkExpensePaid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'e1' }, error: null });
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('sets status=paid, paid_at=now, payment_method, paid_by=currentUser', async () => {
    const { result } = renderHook(() => useMarkExpensePaid(), {
      wrapper: ({ children }) => wrap(children),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', paymentMethod: 'bank_transfer' });
    });
    const payload = update.mock.calls[0][0];
    expect(payload.status).toBe('paid');
    expect(payload.payment_method).toBe('bank_transfer');
    expect(payload.paid_by).toBe('user-1');
    expect(typeof payload.paid_at).toBe('string');
    expect(eq).toHaveBeenCalledWith('id', 'e1');
  });
});
