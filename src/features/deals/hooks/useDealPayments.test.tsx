import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

// Chainable supabase mock. `from` dispatches per table so we can assert each
// leg of the header-insert / job-lookup / line-insert flow independently.
const {
  paymentsInsert,
  paymentsSelect,
  paymentsSingle,
  paymentsUpdate,
  paymentsUpdateEq,
  jobsSelect,
  jobsEq1,
  jobsEq2,
  jobsEq3,
  linesInsert,
  from,
} = vi.hoisted(() => {
  const paymentsSingle = vi.fn();
  const paymentsSelect = vi.fn().mockReturnValue({ single: paymentsSingle });
  const paymentsInsert = vi.fn().mockReturnValue({ select: paymentsSelect });

  const paymentsUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const paymentsUpdate = vi.fn().mockReturnValue({ eq: paymentsUpdateEq });

  const jobsEq3 = vi.fn();
  const jobsEq2 = vi.fn().mockReturnValue({ eq: jobsEq3 });
  const jobsEq1 = vi.fn().mockReturnValue({ eq: jobsEq2 });
  const jobsSelect = vi.fn().mockReturnValue({ eq: jobsEq1 });

  const linesInsert = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === 'deal_payments') return { insert: paymentsInsert, update: paymentsUpdate };
    if (table === 'jobs') return { select: jobsSelect };
    if (table === 'deal_payment_lines') return { insert: linesInsert };
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    paymentsInsert,
    paymentsSelect,
    paymentsSingle,
    paymentsUpdate,
    paymentsUpdateEq,
    jobsSelect,
    jobsEq1,
    jobsEq2,
    jobsEq3,
    linesInsert,
    from,
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_s: string, _o: string, fn: (...a: unknown[]) => unknown) => fn,
}));

import { useAddDealPayment, useUpdateDealPayment } from './useDealPayments';

const DEAL = 'deal-1';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('useAddDealPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linesInsert.mockResolvedValue({ error: null });
  });

  it('links the line to the single matching job and mirrors header amounts', async () => {
    paymentsSingle.mockResolvedValue({
      data: { id: 'pay-1', service_type: 'web_dev', label: 'Header label', amount_net: 500, vat_rate: 24 },
      error: null,
    });
    jobsEq3.mockResolvedValue({ data: [{ id: 'job-7', title: 'Website build' }], error: null });

    const client = newClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAddDealPayment(DEAL), { wrapper: wrap(client) });
    await result.current.mutateAsync({
      service_type: 'web_dev',
      label: 'caller label',
      amount_net: 999,
      vat_rate: 13,
      billing_type: 'one_time',
    } as never);

    // Header inserted with deal_id merged in, then read back.
    expect(paymentsInsert).toHaveBeenCalledWith({
      service_type: 'web_dev',
      label: 'caller label',
      amount_net: 999,
      vat_rate: 13,
      billing_type: 'one_time',
      deal_id: DEAL,
    });
    expect(paymentsSelect).toHaveBeenCalledWith('id, service_type, label, amount_net, vat_rate');

    // Job resolved by the inserted service_type.
    expect(jobsSelect).toHaveBeenCalledWith('id, title');
    expect(jobsEq1).toHaveBeenCalledWith('deal_id', DEAL);
    expect(jobsEq2).toHaveBeenCalledWith('service_type', 'web_dev');
    expect(jobsEq3).toHaveBeenCalledWith('archived', false);

    // Line uses the job + amounts returned by the header insert, not caller input.
    expect(linesInsert).toHaveBeenCalledWith({
      payment_id: 'pay-1',
      job_id: 'job-7',
      label: 'Website build',
      amount_net: 500,
      vat_rate: 24,
    });

    // Adding income must also refresh the financial report / dashboard surfaces.
    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['accounting-ledger']));
    expect(invalidated).toContain(JSON.stringify(['dashboard-monthly-pl']));
  });

  it('falls back to a null job link when the service_type is ambiguous (2 jobs)', async () => {
    paymentsSingle.mockResolvedValue({
      data: { id: 'pay-2', service_type: 'seo', label: 'Header label', amount_net: 300, vat_rate: 24 },
      error: null,
    });
    jobsEq3.mockResolvedValue({
      data: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      error: null,
    });

    const { result } = renderHook(() => useAddDealPayment(DEAL), { wrapper: wrap(newClient()) });
    await result.current.mutateAsync({ service_type: 'seo', label: 'x', amount_net: 1, vat_rate: 24 } as never);

    expect(linesInsert).toHaveBeenCalledWith({
      payment_id: 'pay-2',
      job_id: null,
      label: 'Header label',
      amount_net: 300,
      vat_rate: 24,
    });
  });

  it('does not query jobs when the inserted service_type is null', async () => {
    paymentsSingle.mockResolvedValue({
      data: { id: 'pay-3', service_type: null, label: 'No service', amount_net: 100, vat_rate: 24 },
      error: null,
    });

    const { result } = renderHook(() => useAddDealPayment(DEAL), { wrapper: wrap(newClient()) });
    await result.current.mutateAsync({ label: 'No service', amount_net: 100, vat_rate: 24 } as never);

    expect(from).not.toHaveBeenCalledWith('jobs');
    expect(jobsSelect).not.toHaveBeenCalled();
    expect(linesInsert).toHaveBeenCalledWith({
      payment_id: 'pay-3',
      job_id: null,
      label: 'No service',
      amount_net: 100,
      vat_rate: 24,
    });
  });

  it('treats a jobs-lookup error as no match without failing the mutation', async () => {
    paymentsSingle.mockResolvedValue({
      data: { id: 'pay-4', service_type: 'hosting', label: 'Hdr', amount_net: 50, vat_rate: 24 },
      error: null,
    });
    jobsEq3.mockResolvedValue({ data: null, error: { message: 'lookup boom' } });

    const { result } = renderHook(() => useAddDealPayment(DEAL), { wrapper: wrap(newClient()) });
    await result.current.mutateAsync({ service_type: 'hosting', label: 'Hdr', amount_net: 50, vat_rate: 24 } as never);

    expect(linesInsert).toHaveBeenCalledWith({
      payment_id: 'pay-4',
      job_id: null,
      label: 'Hdr',
      amount_net: 50,
      vat_rate: 24,
    });
  });

  it('rejects and skips the line insert when the header insert errors', async () => {
    paymentsSingle.mockResolvedValue({ data: null, error: { message: 'insert failed' } });

    const { result } = renderHook(() => useAddDealPayment(DEAL), { wrapper: wrap(newClient()) });
    await expect(
      result.current.mutateAsync({ service_type: 'web_dev', label: 'x', amount_net: 1, vat_rate: 24 } as never),
    ).rejects.toThrow('insert failed');

    expect(linesInsert).not.toHaveBeenCalled();
  });

  it('rejects when the line insert errors', async () => {
    paymentsSingle.mockResolvedValue({
      data: { id: 'pay-5', service_type: null, label: 'x', amount_net: 0, vat_rate: 24 },
      error: null,
    });
    linesInsert.mockResolvedValue({ error: { message: 'line failed' } });

    const { result } = renderHook(() => useAddDealPayment(DEAL), { wrapper: wrap(newClient()) });
    await expect(
      result.current.mutateAsync({ label: 'x', amount_net: 0, vat_rate: 24 } as never),
    ).rejects.toThrow('line failed');
  });
});

describe('useUpdateDealPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentsUpdateEq.mockResolvedValue({ error: null });
  });

  it('invalidates the financial report + dashboard keys on success', async () => {
    const client = newClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateDealPayment(DEAL), { wrapper: wrap(client) });
    await result.current.mutateAsync({ id: 'pay-1', patch: { amount_net: 200 } });

    expect(paymentsUpdate).toHaveBeenCalledWith({ amount_net: 200 });
    expect(paymentsUpdateEq).toHaveBeenCalledWith('id', 'pay-1');

    const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(['accounting-ledger']));
    expect(invalidated).toContain(JSON.stringify(['dashboard-monthly-pl']));
  });
});
