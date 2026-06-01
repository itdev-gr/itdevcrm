import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, del, from } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ delete: del });
  return { eq, del, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useDeleteExpense } from './useDeleteExpense';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useDeleteExpense', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes by id', async () => {
    const { result } = renderHook(() => useDeleteExpense(), {
      wrapper: ({ children }) => wrap(children),
    });
    await act(async () => {
      await result.current.mutateAsync('e1');
    });
    expect(from).toHaveBeenCalledWith('expenses');
    expect(eq).toHaveBeenCalledWith('id', 'e1');
  });
});
