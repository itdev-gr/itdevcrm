import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, select, from, rpc } = vi.hoisted(() => {
  const order = vi.fn();
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });
  const rpc = vi.fn();
  return { order, select, from, rpc };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from, rpc } }));

import { usePeriodLocks, useLockPeriod, useUnlockPeriod } from './usePeriodLocks';

function wrap(c: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('usePeriodLocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists locked periods ordered newest first', async () => {
    order.mockResolvedValue({
      data: [
        { period: '2026-07', locked_at: '2026-08-01T00:00:00Z', locked_by: 'u1' },
        { period: '2026-06', locked_at: '2026-07-01T00:00:00Z', locked_by: 'u1' },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePeriodLocks(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('accounting_period_locks');
    expect(select).toHaveBeenCalledWith('period, locked_at, locked_by');
    expect(order).toHaveBeenCalledWith('period', { ascending: false });
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]?.period).toBe('2026-07');
  });

  it('surfaces a load error as a rejection', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const { result } = renderHook(() => usePeriodLocks(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('permission denied');
  });
});

describe('useLockPeriod', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls lock_accounting_period with p_period and invalidates the list', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useLockPeriod(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync('2026-01');
    });
    expect(rpc).toHaveBeenCalledWith('lock_accounting_period', { p_period: '2026-01' });
    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['accounting-period-locks']));
  });

  it('surfaces the admin-only rejection from the DB', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin only' } });
    const { result } = renderHook(() => useLockPeriod(), { wrapper: ({ children }) => wrap(children) });
    await act(async () => {
      await expect(result.current.mutateAsync('2026-01')).rejects.toThrow('admin only');
    });
  });
});

describe('useUnlockPeriod', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls unlock_accounting_period with p_period and invalidates the list', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUnlockPeriod(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync('2026-01');
    });
    expect(rpc).toHaveBeenCalledWith('unlock_accounting_period', { p_period: '2026-01' });
    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['accounting-period-locks']));
  });
});
