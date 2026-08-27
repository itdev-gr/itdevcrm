import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { useResolveCronAlert, useResolveCronAlertsKind } from './useResolveCronAlert';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

describe('useResolveCronAlert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls resolve_integrity_alert with p_id and invalidates the cron-alert list + badge', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useResolveCronAlert(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('alert-1');
    });
    expect(rpc).toHaveBeenCalledWith('resolve_integrity_alert', { p_id: 'alert-1' });
    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['cron-integrity-alerts']));
    expect(invalidated).toContain(JSON.stringify(['integrity-alerts-count']));
  });

  it('surfaces the admin-only rejection from the DB', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin only' } });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResolveCronAlert(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync('alert-1')).rejects.toThrow('admin only');
    });
  });
});

describe('useResolveCronAlertsKind', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls resolve_integrity_alerts_kind with p_kind and invalidates the cron-alert list + badge', async () => {
    rpc.mockResolvedValue({ data: 12, error: null });
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useResolveCronAlertsKind(), { wrapper });
    let resolved: number | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync('flip_out_of_paid_in_full');
    });
    expect(rpc).toHaveBeenCalledWith('resolve_integrity_alerts_kind', {
      p_kind: 'flip_out_of_paid_in_full',
    });
    expect(resolved).toBe(12);
    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['cron-integrity-alerts']));
    expect(invalidated).toContain(JSON.stringify(['integrity-alerts-count']));
  });
});
