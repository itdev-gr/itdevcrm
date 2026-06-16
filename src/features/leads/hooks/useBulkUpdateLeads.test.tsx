import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { inFn, update, from } = vi.hoisted(() => {
  const inFn = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ in: inFn });
  const from = vi.fn().mockReturnValue({ update });
  return { inFn, update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useBulkUpdateLeads } from './useBulkUpdateLeads';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useBulkUpdateLeads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls from("leads"), update(patch), and in("id", ids) with given ids and patch', async () => {
    const { result } = renderHook(() => useBulkUpdateLeads(), {
      wrapper: ({ children }) => wrap(children),
    });

    await result.current.mutateAsync({ ids: ['a', 'b'], patch: { owner_user_id: 'u1' } });

    await waitFor(() => expect(from).toHaveBeenCalledWith('leads'));
    expect(update).toHaveBeenCalledWith({ owner_user_id: 'u1' });
    expect(inFn).toHaveBeenCalledWith('id', ['a', 'b']);
  });

  it('makes no supabase call when ids is empty (early return)', async () => {
    const { result } = renderHook(() => useBulkUpdateLeads(), {
      wrapper: ({ children }) => wrap(children),
    });

    await result.current.mutateAsync({ ids: [], patch: { owner_user_id: 'u1' } });

    expect(from).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(inFn).not.toHaveBeenCalled();
  });
});
