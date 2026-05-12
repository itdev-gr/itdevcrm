import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, update, from } = vi.hoisted(() => {
  const eq = vi.fn();
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { eq, update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useResolveAssignedTask } from './useResolveAssignedTask';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useResolveAssignedTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates the row to status=resolved', async () => {
    eq.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useResolveAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync({ id: 't1' });
    expect(update).toHaveBeenCalledWith({ status: 'resolved' });
    expect(eq).toHaveBeenCalledWith('id', 't1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('throws on error', async () => {
    eq.mockResolvedValue({ error: { message: 'denied' } });
    const { result } = renderHook(() => useResolveAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(result.current.mutateAsync({ id: 't1' })).rejects.toThrow('denied');
  });
});
