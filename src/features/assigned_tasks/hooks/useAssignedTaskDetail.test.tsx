import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, eq, from } = vi.hoisted(() => {
  const single = vi.fn();
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { single, eq, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useAssignedTaskDetail } from './useAssignedTaskDetail';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useAssignedTaskDetail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns task + client essentials + department + creator', async () => {
    single.mockResolvedValue({
      data: {
        id: 't1', title: 'TEST', description: 'd',
        deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000017',
        assignee_user_id: 'u-me', created_by_user_id: 'u-other',
        status: 'open', resolved_at: null, resolved_by_user_id: null,
        created_at: 'now', department_group_id: 'g1',
        client: {
          id: 'c1', name: 'Pindos Outdoor Gear', industry: 'Sports',
          contact_first_name: 'Christos', contact_last_name: 'Tsilis',
          email: 'ct@p.gr', phone: '+30 1',
        },
        creator: { user_id: 'u-other', full_name: 'Smoke Test', email: 's@t.gr' },
        department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
      },
      error: null,
    });
    const { result } = renderHook(() => useAssignedTaskDetail('t1'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.client?.name).toBe('Pindos Outdoor Gear');
    expect(result.current.data!.department?.code).toBe('web_dev');
    expect(from).toHaveBeenCalledWith('assigned_tasks');
    expect(eq).toHaveBeenCalledWith('id', 't1');
  });

  it('is disabled when taskId is null', async () => {
    const { result } = renderHook(() => useAssignedTaskDetail(null), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(from).not.toHaveBeenCalled();
  });
});
