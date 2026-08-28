import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { update, from, eq } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { update, from, eq };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useSetJobDisconnected } from './useJobDisconnect';
import { useAuthStore } from '@/lib/stores/authStore';
import { queryKeys } from '@/lib/queryKeys';

function wrap(
  c: ReactNode,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useSetJobDisconnected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: 'u-1' } as never });
  });

  it('disconnected: true stamps disconnected_at (ISO) and disconnected_by (current user)', async () => {
    const { result } = renderHook(() => useSetJobDisconnected('j1'), {
      wrapper: ({ children }) => wrap(children),
    });
    result.current.mutate({ disconnected: true });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(from).toHaveBeenCalledWith('jobs');
    const payload = update.mock.calls[0]?.[0] as {
      disconnected_at: string;
      disconnected_by: string;
    };
    expect(typeof payload.disconnected_at).toBe('string');
    expect(Number.isNaN(Date.parse(payload.disconnected_at))).toBe(false);
    expect(payload.disconnected_by).toBe('u-1');
    expect(eq).toHaveBeenCalledWith('id', 'j1');
  });

  it('disconnected: false clears both columns (Undo)', async () => {
    const { result } = renderHook(() => useSetJobDisconnected('j1'), {
      wrapper: ({ children }) => wrap(children),
    });
    result.current.mutate({ disconnected: false });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({ disconnected_at: null, disconnected_by: null });
  });

  it('invalidates the job query and every board query on success', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSetJobDisconnected('j1'), {
      wrapper: ({ children }) => wrap(children, qc),
    });
    result.current.mutate({ disconnected: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.job('j1') });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
  });

  it('surfaces a PostgREST error as a thrown Error', async () => {
    eq.mockResolvedValueOnce({ error: { message: 'permission denied for table jobs' } });
    const { result } = renderHook(() => useSetJobDisconnected('j1'), {
      wrapper: ({ children }) => wrap(children),
    });
    result.current.mutate({ disconnected: true });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('permission denied for table jobs');
  });
});
