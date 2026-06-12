import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { select, eq, update, from } = vi.hoisted(() => {
  const select = vi.fn();
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { select, eq, update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useUpdateContract } from './useUpdateContract';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useUpdateContract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('patches the contract and resolves', async () => {
    select.mockResolvedValue({ data: [{ id: 'k1' }], error: null });
    const { result } = renderHook(() => useUpdateContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync({ id: 'k1', patch: { title: 'Νέος τίτλος' } });
    expect(from).toHaveBeenCalledWith('contracts');
    expect(update).toHaveBeenCalledWith({ title: 'Νέος τίτλος' });
    expect(eq).toHaveBeenCalledWith('id', 'k1');
    expect(select).toHaveBeenCalledWith('id');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rejects when RLS matches zero rows (view-only staff)', async () => {
    select.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useUpdateContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(
      result.current.mutateAsync({ id: 'k1', patch: { title: 'x' } }),
    ).rejects.toThrow(/permission/);
  });

  it('rejects with the supabase error message', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'rls denied' } });
    const { result } = renderHook(() => useUpdateContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(
      result.current.mutateAsync({ id: 'k1', patch: { status: 'draft' } }),
    ).rejects.toThrow('rls denied');
  });
});
