import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyCommission } from './useMyCommission';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useMyCommission', () => {
  beforeEach(() => invoke.mockReset());

  it('returns the function payload', async () => {
    invoke.mockResolvedValue({ data: { found: true, total_earnings: 42 }, error: null });
    const { result } = renderHook(() => useMyCommission(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invoke).toHaveBeenCalledWith('my-commission', { body: {} });
    expect(result.current.data).toEqual({ found: true, total_earnings: 42 });
  });

  it('falls back to found:false on an empty payload', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useMyCommission(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ found: false });
  });

  it('surfaces invoke errors', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useMyCommission(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
  });
});
