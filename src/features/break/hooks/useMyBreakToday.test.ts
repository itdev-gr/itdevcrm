import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyBreakToday } from './useMyBreakToday';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useMyBreakToday', () => {
  beforeEach(() => rpc.mockReset());

  it('unwraps the single row from the RPC', async () => {
    rpc.mockResolvedValue({
      data: [{ active_started_at: null, total_seconds: 420 }],
      error: null,
    });
    const { result } = renderHook(() => useMyBreakToday(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('get_my_break_today');
    expect(result.current.data).toEqual({ active_started_at: null, total_seconds: 420 });
  });

  it('returns null when the RPC yields no rows', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useMyBreakToday(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('surfaces RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useMyBreakToday(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
  });
});
