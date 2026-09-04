import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { createCustomJob, updateJobBilling } = vi.hoisted(() => ({
  createCustomJob: vi.fn(),
  updateJobBilling: vi.fn(),
}));

vi.mock('@/lib/rpc', () => ({ createCustomJob, updateJobBilling }));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_s: string, _o: string, fn: (...a: unknown[]) => unknown) => fn,
}));

import {
  useCreateCustomJob,
  useUpdateJobBilling,
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
});
