import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, update, single, insert, from } = vi.hoisted(() => {
  const eq = vi.fn();
  const update = vi.fn().mockReturnValue({ eq });
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ update, insert });
  return { eq, update, single, insert, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useUpsertClient } from './useUpsertClient';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useUpsertClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts when no id is provided', async () => {
    single.mockResolvedValue({ data: { id: 'c1' }, error: null });
    const { result } = renderHook(() => useUpsertClient(), {
      wrapper: ({ children }) => wrap(children),
    });
    const id = await result.current.mutateAsync({ name: 'Acme' });
    expect(insert).toHaveBeenCalledWith({ name: 'Acme' });
    expect(id).toBe('c1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('updates when id is provided', async () => {
    eq.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useUpsertClient(), {
      wrapper: ({ children }) => wrap(children),
    });
    const id = await result.current.mutateAsync({ id: 'c1', name: 'New name' });
    expect(update).toHaveBeenCalledWith({ name: 'New name' });
    expect(id).toBe('c1');
  });

  it('throws on insert error', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'fail' } });
    const { result } = renderHook(() => useUpsertClient(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(result.current.mutateAsync({ name: 'X' })).rejects.toThrow('fail');
  });
});
