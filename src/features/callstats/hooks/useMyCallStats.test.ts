import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { useMyCallStats } from './useMyCallStats';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useMyCallStats', () => {
  beforeEach(() => rpc.mockReset());

  it('returns the first row from the RPC array', async () => {
    rpc.mockResolvedValue({ data: [{ extension: '207', total: 5, missed: 2, talk_seconds: 72, recent: [] }], error: null });
    const { result } = renderHook(() => useMyCallStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.extension).toBe('207');
    expect(result.current.data?.total).toBe(5);
  });

  it('returns null when the RPC returns an empty array (no row)', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useMyCallStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
