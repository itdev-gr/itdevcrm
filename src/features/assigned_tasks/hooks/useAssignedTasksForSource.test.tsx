import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, select, from } = vi.hoisted(() => {
  const order = vi.fn().mockResolvedValue({
    data: [
      {
        id: 't1', title: 'Fix SSL', description: null,
        deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000001',
        assignee_user_id: 'u1', created_by_user_id: 'u2',
        status: 'open', resolved_at: null, resolved_by_user_id: null, created_at: 't',
        department_group_id: 'g1',
        client: { id: 'c1', name: 'Acme' },
        department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
      },
    ],
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, select, from };
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

  it('returns the nested department per task', async () => {
    const { result } = renderHook(() => useAssignedTasksForSource({ kind: 'deal', id: 'd1' }), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0]?.department?.code).toBe('web_dev');
    expect(select).toHaveBeenCalledWith(expect.stringContaining('department:department_group_id'));
  });
});
