import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc, is, select, from } = vi.hoisted(() => {
  const is = vi.fn();
  const select = vi.fn();
  const from = vi.fn();
  const rpc = vi.fn();
  return { rpc, is, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));

import { useAlertsCount } from './useAlertsCount';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useAlertsCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnValue({ is });
    from.mockReturnValue({ select });
  });

  it('sums the live-RPC count and the open cron-alert count', async () => {
    rpc.mockResolvedValue({ data: 7, error: null });
    is.mockResolvedValue({ count: 348, error: null, data: null });
    const { result } = renderHook(() => useAlertsCount(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.data).toBe(355));
    expect(rpc).toHaveBeenCalledWith('accounting_integrity_alerts_count');
    expect(from).toHaveBeenCalledWith('data_integrity_alerts');
    expect(select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    expect(is).toHaveBeenCalledWith('resolved_at', null);
  });

  it('treats a non-admin RLS-filtered zero count as zero, not an error', async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    is.mockResolvedValue({ count: 0, error: null, data: null });
    const { result } = renderHook(() => useAlertsCount(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.data).toBe(0));
  });
});
