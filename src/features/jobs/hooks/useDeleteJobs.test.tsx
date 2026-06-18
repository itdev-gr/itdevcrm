import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { deleteJobs } = vi.hoisted(() => ({ deleteJobs: vi.fn() }));
vi.mock('@/lib/rpc', () => ({ deleteJobs }));

import { useDeleteJobs } from './useDeleteJobs';

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useDeleteJobs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls deleteJobs and invalidates job lists on success', async () => {
    deleteJobs.mockResolvedValue({ ok: true, deletedCount: 1 });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteJobs(), { wrapper: wrap(qc) });

    result.current.mutate(['j1']);

    await waitFor(() => expect(deleteJobs).toHaveBeenCalledWith(['j1']));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['jobs'] })),
    );
  });

  it('throws when the RPC reports failure', async () => {
    deleteJobs.mockResolvedValue({ ok: false, errors: ['not_admin'] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteJobs(), { wrapper: wrap(qc) });

    result.current.mutate(['j1']);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('not_admin');
  });
});
