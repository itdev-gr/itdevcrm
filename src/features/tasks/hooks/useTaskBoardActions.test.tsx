import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const rpc = vi.fn();
const eq = vi.fn();
const update = vi.fn(() => ({ eq }));
const from = vi.fn((..._a: unknown[]) => ({ update }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  },
}));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_domain: string, _op: string, fn: unknown) => fn,
}));

import { useTaskBoardActions } from './useTaskBoardActions';
import type { TaskCard } from '../taskCard';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useTaskBoardActions — withdraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: null, error: null });
    eq.mockResolvedValue({ error: null });
  });

  it('assigned card: unresolve_task RPC then importance update', async () => {
    const card = { kind: 'assigned', id: 't1' } as TaskCard;
    const { result } = renderHook(() => useTaskBoardActions(), { wrapper });
    result.current.mutate({ card, action: { type: 'withdraw', importance: 'high' } });
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('unresolve_task', { p_kind: 'assigned', p_task_id: 't1' }),
    );
    await waitFor(() => expect(update).toHaveBeenCalledWith({ importance: 'high' }));
    expect(from).toHaveBeenCalledWith('assigned_tasks');
  });

  it('user card routes the importance update to user_tasks', async () => {
    const card = { kind: 'user', id: 'u1' } as TaskCard;
    const { result } = renderHook(() => useTaskBoardActions(), { wrapper });
    result.current.mutate({ card, action: { type: 'withdraw', importance: 'low' } });
    await waitFor(() => expect(from).toHaveBeenCalledWith('user_tasks'));
    expect(rpc).toHaveBeenCalledWith('unresolve_task', { p_kind: 'user', p_task_id: 'u1' });
  });
});
