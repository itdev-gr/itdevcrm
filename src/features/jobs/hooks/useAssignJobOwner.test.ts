import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { supabaseFrom, supabaseUpdate, supabaseEq } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { supabaseFrom: from, supabaseUpdate: update, supabaseEq: eq };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: supabaseFrom } }));

import { useAssignJobOwner } from './useAssignJobOwner';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
}

describe('useAssignJobOwner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assigns an owner and invalidates the job + provided keys', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useAssignJobOwner(), { wrapper: wrap(qc) });
    await result.current.mutateAsync({
      jobId: 'job-1',
      ownerUserId: 'user-9',
      invalidate: [['jobs', 'deal', 'deal-1'], ['jobs', 'service', 'web_seo']],
    });

    expect(supabaseFrom).toHaveBeenCalledWith('jobs');
    expect(supabaseUpdate).toHaveBeenCalledWith({ owner_user_id: 'user-9' });
    expect(supabaseEq).toHaveBeenCalledWith('id', 'job-1');

    await waitFor(() => {
      const keys = invalidatedKeys(invalidate);
      expect(keys).toContainEqual(['job', 'job-1']);
      expect(keys).toContainEqual(['jobs', 'deal', 'deal-1']);
      expect(keys).toContainEqual(['jobs', 'service', 'web_seo']);
    });
  });

  it('clears the owner (empty string → null)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAssignJobOwner(), { wrapper: wrap(qc) });
    await result.current.mutateAsync({ jobId: 'job-2', ownerUserId: '' });
    expect(supabaseUpdate).toHaveBeenCalledWith({ owner_user_id: null });
    expect(supabaseEq).toHaveBeenCalledWith('id', 'job-2');
  });
});
