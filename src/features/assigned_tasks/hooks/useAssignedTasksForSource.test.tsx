import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, from } = vi.hoisted(() => {
  const order = vi.fn().mockResolvedValue({ data: [], error: null });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useAssignedTasksForSource } from './useAssignedTasksForSource';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useAssignedTasksForSource', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters by deal_id when source is a deal', async () => {
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'deal', id: 'd1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eq).toHaveBeenCalledWith('deal_id', 'd1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('filters by job_id when source is a job', async () => {
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'job', id: 'j1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eq).toHaveBeenCalledWith('job_id', 'j1');
  });
});
