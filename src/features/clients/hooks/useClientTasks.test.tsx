import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { userResp, assignedResp } = vi.hoisted(() => ({
  userResp: { value: { data: [] as unknown[], error: null } },
  assignedResp: { value: { data: [] as unknown[], error: null } },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve(table === 'user_tasks' ? userResp.value : assignedResp.value),
        }),
      }),
    }),
  },
}));

import { useClientTasks } from './useClientTasks';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useClientTasks', () => {
  beforeEach(() => {
    userResp.value = { data: [], error: null };
    assignedResp.value = { data: [], error: null };
  });

  it('unions personal + delegated tasks for the client', async () => {
    userResp.value = { data: [{ id: 'u1', title: 'P', user_id: 'me', created_by: 'me', completed_at: null, due_at: '2026-07-01T10:00:00Z', importance: 'low', client_id: 'c1', notes: null }], error: null };
    assignedResp.value = { data: [{ id: 'a1', title: 'A', assignee_user_id: 'me', created_by_user_id: 'me', status: 'open', resolved_at: null, importance: 'high', source_code: 'D-1', deal_id: 'd1', job_id: null, client_id: 'c1', description: null, client: { id: 'c1', name: 'ACME' } }], error: null };
    const { result } = renderHook(() => useClientTasks('c1', 'me'), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    expect(result.current.cards.map((c) => c.kind).sort()).toEqual(['assigned', 'user']);
  });
});
