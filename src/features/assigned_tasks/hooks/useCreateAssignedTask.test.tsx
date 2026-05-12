import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, insert, from } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  return { single, insert, from };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'me' } } }) },
  },
}));

import { useCreateAssignedTask } from './useCreateAssignedTask';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useCreateAssignedTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a deal-scoped task with the current user as creator', async () => {
    single.mockResolvedValue({ data: { id: 't1' }, error: null });
    const { result } = renderHook(() => useCreateAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    const id = await result.current.mutateAsync({
      source: { kind: 'deal', id: 'd1' },
      title: 'Renew domain',
      description: 'before May 30',
      assigneeUserId: 'u2',
    });
    expect(id).toBe('t1');
    expect(insert).toHaveBeenCalledWith({
      title: 'Renew domain',
      description: 'before May 30',
      deal_id: 'd1',
      job_id: null,
      assignee_user_id: 'u2',
      created_by_user_id: 'me',
    });
  });

  it('inserts a job-scoped task and sets deal_id null', async () => {
    single.mockResolvedValue({ data: { id: 't2' }, error: null });
    const { result } = renderHook(() => useCreateAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync({
      source: { kind: 'job', id: 'j1' },
      title: 'Hotfix',
      description: null,
      assigneeUserId: 'u3',
    });
    expect(insert).toHaveBeenCalledWith({
      title: 'Hotfix',
      description: null,
      deal_id: null,
      job_id: 'j1',
      assignee_user_id: 'u3',
      created_by_user_id: 'me',
    });
  });

  it('throws on insert error', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'rls denied' } });
    const { result } = renderHook(() => useCreateAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(
      result.current.mutateAsync({
        source: { kind: 'deal', id: 'd1' },
        title: 'x',
        description: null,
        assigneeUserId: 'u2',
      }),
    ).rejects.toThrow('rls denied');
  });
});
