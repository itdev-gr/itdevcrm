import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, update, from } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { eq, update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_scope: string, _op: string, fn: (...args: unknown[]) => unknown) => fn,
}));

import { useMoveAccountingStage } from './useMoveAccountingStage';
import { queryKeys } from '@/lib/queryKeys';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useMoveAccountingStage', () => {
  beforeEach(() => {
    from.mockClear();
    update.mockClear();
    eq.mockClear();
  });

  it('invalidates accountingDeals, the deal detail query and clients on settle', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useMoveAccountingStage(), { wrapper: wrap(qc) });

    await result.current.mutateAsync({ dealId: 'deal-1', stageId: 'stage-on-hold' });

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
      expect(keys).toContainEqual(queryKeys.accountingDeals());
      expect(keys).toContainEqual(queryKeys.deal('deal-1'));
      expect(keys).toContainEqual(queryKeys.clients());
    });
  });
});
