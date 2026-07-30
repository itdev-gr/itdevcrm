import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { createCustomJob, updateJobBilling, endJob } = vi.hoisted(() => ({
  createCustomJob: vi.fn(),
  updateJobBilling: vi.fn(),
  endJob: vi.fn(),
}));

const { supabaseFrom, supabaseUpdate, supabaseEq } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { supabaseFrom: from, supabaseUpdate: update, supabaseEq: eq };
});

vi.mock('@/lib/rpc', () => ({ createCustomJob, updateJobBilling, endJob }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: supabaseFrom } }));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_s: string, _o: string, fn: (...a: unknown[]) => unknown) => fn,
}));

import {
  useCreateCustomJob,
  useUpdateJobBilling,
  useEndJob,
  useUpdateJobDeliveryDueDate,
  mergeDueDate,
} from './useCustomJobMutations';

const DEAL = 'deal-1';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const EXPECTED_INVALIDATIONS = [
  ['jobs-billing', DEAL],
  ['deal-payments', DEAL],
  ['accounting-deals'],
  ['deal', DEAL],
];

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
}

describe('useCustomJobMutations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('useCreateCustomJob calls the RPC with dealId merged in and invalidates', async () => {
    createCustomJob.mockResolvedValue({ ok: true, job_id: 'job-9' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useCreateCustomJob(DEAL), { wrapper: wrap(qc) });
    const id = await result.current.mutateAsync({
      title: 'Extra page',
      description: null,
      department: 'web_dev',
      billingType: 'one_time',
      amountNet: 500,
      vatRate: 24,
      setupFee: 0,
      billingOnly: false,
    });

    expect(id).toBe('job-9');
    expect(createCustomJob).toHaveBeenCalledWith({
      dealId: DEAL,
      title: 'Extra page',
      description: null,
      department: 'web_dev',
      billingType: 'one_time',
      amountNet: 500,
      vatRate: 24,
      setupFee: 0,
      billingOnly: false,
    });

    await waitFor(() => {
      const keys = invalidatedKeys(invalidate);
      for (const k of EXPECTED_INVALIDATIONS) expect(keys).toContainEqual(k);
    });
  });

  it('useCreateCustomJob throws when the RPC returns ok:false', async () => {
    createCustomJob.mockResolvedValue({ ok: false, errors: ['not_allowed'] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCreateCustomJob(DEAL), { wrapper: wrap(qc) });

    await expect(
      result.current.mutateAsync({
        title: 'x',
        department: 'web_dev',
        billingType: 'one_time',
        amountNet: 1,
        vatRate: 24,
      }),
    ).rejects.toThrow('not_allowed');
  });

  it('useUpdateJobBilling calls the RPC and invalidates', async () => {
    updateJobBilling.mockResolvedValue({ ok: true, job_id: 'job-1' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateJobBilling(DEAL), { wrapper: wrap(qc) });
    await result.current.mutateAsync({ jobId: 'job-1', amountNet: 300 });

    expect(updateJobBilling).toHaveBeenCalledWith({ jobId: 'job-1', amountNet: 300 });
    await waitFor(() => {
      const keys = invalidatedKeys(invalidate);
      for (const k of EXPECTED_INVALIDATIONS) expect(keys).toContainEqual(k);
    });
  });

  it('useEndJob calls the RPC with the job id and invalidates', async () => {
    endJob.mockResolvedValue({ ok: true, job_id: 'job-2' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useEndJob(DEAL), { wrapper: wrap(qc) });
    await result.current.mutateAsync('job-2');

    expect(endJob).toHaveBeenCalledWith('job-2');
    await waitFor(() => {
      const keys = invalidatedKeys(invalidate);
      for (const k of EXPECTED_INVALIDATIONS) expect(keys).toContainEqual(k);
    });
  });

  it('useUpdateJobDeliveryDueDate merges due_date into details and invalidates board + billing', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateJobDeliveryDueDate(DEAL), { wrapper: wrap(qc) });
    await result.current.mutateAsync({
      jobId: 'job-7',
      details: { website: 'x.gr' },
      dueDate: '2026-08-15',
      department: 'ads',
    });

    // preserves other detail keys, sets due_date
    expect(supabaseFrom).toHaveBeenCalledWith('jobs');
    expect(supabaseUpdate).toHaveBeenCalledWith({ details: { website: 'x.gr', due_date: '2026-08-15' } });
    expect(supabaseEq).toHaveBeenCalledWith('id', 'job-7');

    await waitFor(() => {
      const keys = invalidatedKeys(invalidate);
      for (const k of EXPECTED_INVALIDATIONS) expect(keys).toContainEqual(k);
      expect(keys).toContainEqual(['job', 'job-7']);
      expect(keys).toContainEqual(['jobs', 'service', 'ads']);
    });
  });
});

describe('mergeDueDate', () => {
  it('sets due_date while preserving other keys', () => {
    expect(mergeDueDate({ website: 'x', industry: 'y' }, '2026-08-01')).toEqual({
      website: 'x',
      industry: 'y',
      due_date: '2026-08-01',
    });
  });

  it('removes due_date when cleared (empty or null)', () => {
    expect(mergeDueDate({ website: 'x', due_date: '2026-08-01' }, '')).toEqual({ website: 'x' });
    expect(mergeDueDate({ website: 'x', due_date: '2026-08-01' }, null)).toEqual({ website: 'x' });
  });

  it('handles null details', () => {
    expect(mergeDueDate(null, '2026-08-01')).toEqual({ due_date: '2026-08-01' });
    expect(mergeDueDate(null, null)).toEqual({});
  });
});
