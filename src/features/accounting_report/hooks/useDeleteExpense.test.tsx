import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, from } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ delete: del });
  return { eq, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useDeleteExpense } from './useDeleteExpense';

describe('useDeleteExpense', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes by id', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteExpense(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync('e1');
    });
    expect(from).toHaveBeenCalledWith('expenses');
    expect(eq).toHaveBeenCalledWith('id', 'e1');
    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['dashboard-monthly-pl']));
  });
});
