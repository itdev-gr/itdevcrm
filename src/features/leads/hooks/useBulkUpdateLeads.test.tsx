import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { inFn, update, from, rpc } = vi.hoisted(() => {
  const inFn = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ in: inFn });
  const from = vi.fn().mockReturnValue({ update });
  const rpc = vi.fn().mockResolvedValue({ error: null });
  return { inFn, update, from, rpc };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from, rpc } }));

import { useBulkUpdateLeads } from './useBulkUpdateLeads';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useBulkUpdateLeads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes owner_user_id through the reassign_leads RPC (PG17 select-policy on new rows)', async () => {
    const { result } = renderHook(() => useBulkUpdateLeads(), {
      wrapper: ({ children }) => wrap(children),
    });

    await result.current.mutateAsync({ ids: ['a', 'b'], patch: { owner_user_id: 'u1' } });

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('reassign_leads', { p_lead_ids: ['a', 'b'], p_new_owner: 'u1' }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('non-owner fields still go through a plain update', async () => {
    const { result } = renderHook(() => useBulkUpdateLeads(), {
      wrapper: ({ children }) => wrap(children),
    });

    await result.current.mutateAsync({ ids: ['a', 'b'], patch: { industry: 'x' } });

    await waitFor(() => expect(from).toHaveBeenCalledWith('leads'));
    expect(update).toHaveBeenCalledWith({ industry: 'x' });
    expect(inFn).toHaveBeenCalledWith('id', ['a', 'b']);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('mixed patch splits: owner via RPC, the rest via update', async () => {
    const { result } = renderHook(() => useBulkUpdateLeads(), {
      wrapper: ({ children }) => wrap(children),
    });

    await result.current.mutateAsync({ ids: ['a'], patch: { owner_user_id: null, industry: 'x' } });

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('reassign_leads', { p_lead_ids: ['a'], p_new_owner: null }),
    );
    expect(update).toHaveBeenCalledWith({ industry: 'x' });
  });

  it('makes no supabase call when ids is empty (early return)', async () => {
    const { result } = renderHook(() => useBulkUpdateLeads(), {
      wrapper: ({ children }) => wrap(children),
    });

    await result.current.mutateAsync({ ids: [], patch: { owner_user_id: 'u1' } });

    expect(from).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
