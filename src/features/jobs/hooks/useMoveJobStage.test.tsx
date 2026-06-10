import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { update, from } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useMoveJobStage } from './useMoveJobStage';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useMoveJobStage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stamps completed_at when moving into a completed-terminal stage', async () => {
    const { result } = renderHook(() => useMoveJobStage('local_seo'), {
      wrapper: ({ children }) => wrap(children),
    });
    result.current.mutate({ jobId: 'j1', stageId: 's-done', completed: true });
    await waitFor(() => expect(update).toHaveBeenCalled());
    const payload = update.mock.calls[0]?.[0] as { stage_id: string; completed_at: string };
    expect(payload.stage_id).toBe('s-done');
    expect(typeof payload.completed_at).toBe('string');
  });

  it('clears completed_at when moving into a non-terminal stage', async () => {
    const { result } = renderHook(() => useMoveJobStage('local_seo'), {
      wrapper: ({ children }) => wrap(children),
    });
    result.current.mutate({ jobId: 'j1', stageId: 's-opt', completed: false });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toMatchObject({ stage_id: 's-opt', completed_at: null });
  });

  it('leaves completed_at untouched when the flag is not provided', async () => {
    const { result } = renderHook(() => useMoveJobStage('local_seo'), {
      wrapper: ({ children }) => wrap(children),
    });
    result.current.mutate({ jobId: 'j1', stageId: 's-x' });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).not.toHaveProperty('completed_at');
  });
});
