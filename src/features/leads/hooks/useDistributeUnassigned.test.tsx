import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

// Mirror @supabase/supabase-js: `rpc()` is a prototype method whose body is
// `return this.rest.rpc(...)`. Capturing `supabase.rpc` into a bare const
// detaches `this`, which crashes with
// "Cannot read properties of undefined (reading 'rest')".
const { restRpc } = vi.hoisted(() => ({
  restRpc: vi.fn((_fn: string, _args?: unknown) => Promise.resolve({ data: 5, error: null })),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rest: { rpc: restRpc },
    rpc(fn: string, args?: unknown) {
      return this.rest.rpc(fn, args);
    },
  },
}));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_scope: string, _op: string, fn: (...args: unknown[]) => unknown) => fn,
}));

import { queryKeys } from '@/lib/queryKeys';
import { useDistributeUnassigned } from './useDistributeUnassigned';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useDistributeUnassigned', () => {
  beforeEach(() => {
    restRpc.mockClear();
  });

  it('calls distribute_unassigned_leads without losing the supabase `this` binding', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDistributeUnassigned(), { wrapper: wrap(qc) });

    const count = await result.current.mutateAsync();

    expect(count).toBe(5);
    expect(restRpc).toHaveBeenCalledWith('distribute_unassigned_leads', undefined);
  });

  it('awaits the leads refetch before resolving so the UI shows fresh counts', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    let releaseRefetch!: () => void;
    const refetchGate = new Promise<void>((res) => {
      releaseRefetch = res;
    });
    vi.spyOn(qc, 'invalidateQueries').mockReturnValue(refetchGate as unknown as Promise<void>);

    const { result } = renderHook(() => useDistributeUnassigned(), { wrapper: wrap(qc) });

    let resolved = false;
    const done = result.current.mutateAsync().then(() => {
      resolved = true;
    });

    // Flush micro- and macro-tasks; the mutation must still be pending on the refetch.
    await new Promise((r) => setTimeout(r, 0));
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.leads() });
    expect(resolved).toBe(false);

    releaseRefetch();
    await done;
    expect(resolved).toBe(true);
  });
});
