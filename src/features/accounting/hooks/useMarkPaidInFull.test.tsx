import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { markPaidInFull } = vi.hoisted(() => ({ markPaidInFull: vi.fn() }));

vi.mock('@/lib/rpc', () => ({ markPaidInFull }));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_s: string, _o: string, fn: (...a: unknown[]) => unknown) => fn,
}));

import { useMarkPaidInFull } from './useMarkPaidInFull';
import { queryKeys } from '@/lib/queryKeys';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useMarkPaidInFull', () => {
  beforeEach(() => markPaidInFull.mockReset());

  it('invalidates accountingDeals, deal and clients on success', async () => {
    markPaidInFull.mockResolvedValue({ ok: true, deal_id: 'deal-1', mode: 'unlocked' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useMarkPaidInFull(), { wrapper: wrap(qc) });
    await result.current.mutateAsync('deal-1');

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
      expect(keys).toContainEqual(queryKeys.accountingDeals());
      expect(keys).toContainEqual(queryKeys.deal('deal-1'));
      expect(keys).toContainEqual(queryKeys.clients());
    });
  });

  it('throws with .errors when the rpc returns ok:false', async () => {
    markPaidInFull.mockResolvedValue({ ok: false, errors: ['services_planned_empty'] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMarkPaidInFull(), { wrapper: wrap(qc) });

    await expect(result.current.mutateAsync('deal-1')).rejects.toMatchObject({
      errors: ['services_planned_empty'],
    });
  });
});
