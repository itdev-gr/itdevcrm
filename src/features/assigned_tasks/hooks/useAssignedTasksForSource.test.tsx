import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { fromMock, state } = vi.hoisted(() => {
  const state = {
    jobIds: [] as { id: string }[],
    tasks: [] as unknown[],
    lastOr: null as string | null,
    lastEq: null as [string, string] | null,
  };
  // supabase.from('jobs') -> select().eq() resolves job ids;
  // supabase.from('assigned_tasks') -> select().or()/.eq().order() resolves tasks.
  const fromMock = vi.fn((table: string) => {
    if (table === 'jobs') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: state.jobIds, error: null }),
        }),
      };
    }
    return {
      select: () => ({
        or: (expr: string) => {
          state.lastOr = expr;
          return { order: () => Promise.resolve({ data: state.tasks, error: null }) };
        },
        eq: (col: string, val: string) => {
          state.lastEq = [col, val];
          return { order: () => Promise.resolve({ data: state.tasks, error: null }) };
        },
      }),
    };
  });
  return { fromMock, state };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

import { useAssignedTasksForSource } from './useAssignedTasksForSource';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useAssignedTasksForSource — deal kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.jobIds = [];
    state.tasks = [];
    state.lastOr = null;
    state.lastEq = null;
  });

  it('unions deal tasks with the deal jobs tasks when the deal has jobs', async () => {
    state.jobIds = [{ id: 'job-1' }, { id: 'job-2' }];
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'deal', id: 'deal-1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.lastOr).toBe('deal_id.eq.deal-1,job_id.in.(job-1,job-2)');
  });

  it('falls back to a plain deal_id filter when the deal has no jobs', async () => {
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'deal', id: 'deal-1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.lastEq).toEqual(['deal_id', 'deal-1']);
    expect(state.lastOr).toBeNull();
  });

  it('job kind is unchanged (no jobs pre-query)', async () => {
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'job', id: 'job-9' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.lastEq).toEqual(['job_id', 'job-9']);
    expect(fromMock).not.toHaveBeenCalledWith('jobs');
  });
});
