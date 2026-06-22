import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, is, from } = vi.hoisted(() => {
  const order = vi.fn();
  const eq: ReturnType<typeof vi.fn> = vi.fn();
  eq.mockReturnValue({ eq, order });
  const is = vi.fn().mockReturnValue({ eq, order });
  const select = vi.fn().mockReturnValue({ is });
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, is, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useOpenUserTasks } from './useOpenUserTasks';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useOpenUserTasks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches open (not-completed) tasks for a specific assignee, soonest due first', async () => {
    order.mockResolvedValue({
      data: [{ id: 'p1', title: 'Call back lead', user_id: 'u1', completed_at: null, due_at: 't' }],
      error: null,
    });
    const { result } = renderHook(() => useOpenUserTasks({ assigneeUserId: 'u1' }), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('user_tasks');
    expect(is).toHaveBeenCalledWith('completed_at', null);
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(order).toHaveBeenCalledWith('due_at', { ascending: true });
    expect(result.current.data?.[0]?.id).toBe('p1');
  });

  it('skips the assignee filter when assigneeUserId is null (admin all-team)', async () => {
    const orderDirect = vi.fn().mockResolvedValue({ data: [], error: null });
    const isAll = vi.fn().mockReturnValue({ order: orderDirect });
    const selectAll = vi.fn().mockReturnValue({ is: isAll });
    from.mockReturnValueOnce({ select: selectAll });

    const { result } = renderHook(() => useOpenUserTasks({ assigneeUserId: null }), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(isAll).toHaveBeenCalledWith('completed_at', null);
    expect(orderDirect).toHaveBeenCalledWith('due_at', { ascending: true });
    expect(eq).not.toHaveBeenCalledWith('user_id', expect.anything());
  });
});
