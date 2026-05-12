import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, select, from } = vi.hoisted(() => {
  const order = vi.fn();
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useAssignedTasksOpen } from './useAssignedTasksOpen';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useAssignedTasksOpen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches open tasks for a specific assignee, newest first', async () => {
    order.mockResolvedValue({
      data: [{ id: 't1', title: 'Renew domain', status: 'open' }],
      error: null,
    });
    const { result } = renderHook(
      () => useAssignedTasksOpen({ assigneeUserId: 'u1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('assigned_tasks');
    expect(select).toHaveBeenCalledWith(expect.stringContaining('client:client_id'));
    expect(eq).toHaveBeenCalledWith('assignee_user_id', 'u1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result.current.data?.[0].id).toBe('t1');
  });

  it('skips the assignee filter when assigneeUserId is null (admin all-team)', async () => {
    // When assigneeUserId is null, the hook should not call .eq("assignee_user_id", ...).
    // Instead it should call .order directly on the select chain (status filter only).
    const orderDirect = vi.fn().mockResolvedValue({ data: [], error: null });
    const eqStatus = vi.fn().mockReturnValue({ order: orderDirect });
    const selectAll = vi.fn().mockReturnValue({ eq: eqStatus });
    from.mockReturnValueOnce({ select: selectAll });

    const { result } = renderHook(
      () => useAssignedTasksOpen({ assigneeUserId: null }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqStatus).toHaveBeenCalledWith('status', 'open');
    expect(orderDirect).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
