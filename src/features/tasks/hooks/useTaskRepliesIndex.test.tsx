import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TaskCard } from '../taskCard';

// Chainable PostgREST stub: every filter returns the builder; awaiting it
// resolves with the queued page. `calls` records the filter arguments.
const calls: Array<Record<string, unknown>> = [];
let pages: Array<{ user_task_id: string | null; assigned_task_id: string | null }[]> = [];
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const call: Record<string, unknown> = {};
      calls.push(call);
      const builder = {
        select: () => builder,
        in: (col: string, ids: string[]) => { call['in'] = [col, ids]; return builder; },
        neq: (col: string, v: string) => { call['neq'] = [col, v]; return builder; },
        range: (from: number, to: number) => { call['range'] = [from, to]; return builder; },
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({ data: pages.shift() ?? [], error: null }),
      };
      return builder;
    },
  },
}));
vi.mock('@/features/notifications/hooks/useUnreadCommentNotifs', () => ({
  useUnreadCommentNotifs: () => ({ data: [] }),
}));

import { useTaskRepliesIndex } from './useTaskRepliesIndex';

const card = (o: Partial<TaskCard>): TaskCard => ({
  key: 'assigned:a1', kind: 'assigned', id: 'a1', title: 't', importance: 'low',
  relation: 'mine', resolved: false, assigneeId: 'me', creatorId: 'boss',
  createdAtIso: null, dueAt: null, resolvedAt: null, startedAtIso: null,
  sourceCode: null, link: null, notes: null, clientName: null, clientId: null, leadName: null,
  creatorResolvedAt: null, assigneeResolvedAt: null, summary: null, ...o,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useTaskRepliesIndex', () => {
  beforeEach(() => { calls.length = 0; pages = []; });

  it('returns the card keys that have foreign comments', async () => {
    pages = [[{ user_task_id: null, assigned_task_id: 'a1' }]];
    const { result } = renderHook(
      () => useTaskRepliesIndex([card({}), card({ key: 'assigned:a2', id: 'a2' })], 'me'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.has('assigned:a1')).toBe(true));
    expect(result.current.has('assigned:a2')).toBe(false);
    // filters: scoped to the candidate ids, excluding my own comments
    expect(calls[0]?.['in']).toEqual(['assigned_task_id', ['a1', 'a2']]);
    expect(calls[0]?.['neq']).toEqual(['author_user_id', 'me']);
  });

  it('issues no query when there are no candidate cards', () => {
    const { result } = renderHook(
      () => useTaskRepliesIndex([card({ resolved: true }), card({ id: 'a9', key: 'assigned:a9', relation: 'other' })], 'me'),
      { wrapper },
    );
    expect(result.current.size).toBe(0);
    expect(calls.length).toBe(0);
  });
});
