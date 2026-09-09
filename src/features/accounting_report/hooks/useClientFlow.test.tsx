import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { useClientFlow } from './useClientFlow';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(c: ReactNode, qc: QueryClient = makeClient()) {
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

const ROWS = [
  {
    kind: 'renewal_client',
    client_id: 'c3',
    client_name: 'Gamma',
    client_code: '000003',
    deal_id: null,
    deal_code: null,
    event_date: '2026-09-02',
  },
  {
    kind: 'new_deal',
    client_id: 'c1',
    client_name: 'Alpha',
    client_code: '007001',
    deal_id: 'd1',
    deal_code: '007001',
    event_date: '2026-09-05',
  },
  {
    kind: 'stopped_client',
    client_id: 'c2',
    client_name: 'Beta',
    client_code: '000002',
    deal_id: null,
    deal_code: null,
    event_date: '2026-09-10',
  },
];

describe('useClientFlow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls client_flow_for_range with the range and groups rows by kind', async () => {
    rpc.mockResolvedValue({ data: ROWS, error: null });
    const { result } = renderHook(
      () => useClientFlow({ from: '2026-09-01', to: '2026-09-30' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('client_flow_for_range', {
      p_from: '2026-09-01',
      p_to: '2026-09-30',
    });
    expect(result.current.data?.newDeals).toEqual([ROWS[1]]);
    expect(result.current.data?.stopped).toEqual([ROWS[2]]);
    expect(result.current.data?.renewals).toEqual([ROWS[0]]);
  });

  it('yields empty groups on an empty RPC response', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () => useClientFlow({ from: '2026-08-01', to: '2026-08-31' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ newDeals: [], stopped: [], renewals: [] });
  });

  it('surfaces RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin only' } });
    const { result } = renderHook(
      () => useClientFlow({ from: '2026-09-01', to: '2026-09-30' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('admin only');
  });
});
