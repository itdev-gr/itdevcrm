import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, eq, update, from } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { single, eq, update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useUpdateExpense } from './useUpdateExpense';

describe('useUpdateExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'e1' }, error: null });
  });

  it('updates only fields supplied, mapped to db column names', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateExpense(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'e1',
        patch: { vendor: 'Adobe (renewed)', notes: 'updated', amountNet: 150 },
      });
    });
    expect(update).toHaveBeenCalledWith({
      vendor: 'Adobe (renewed)',
      notes: 'updated',
      amount_net: 150,
    });
    expect(eq).toHaveBeenCalledWith('id', 'e1');
    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['dashboard-monthly-pl']));
  });
});
