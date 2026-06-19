import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, from } = vi.hoisted(() => {
  const order = vi.fn();
  const eq = vi.fn();
  const chain: Record<string, unknown> = { eq, order };
  eq.mockReturnValue(chain);
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useLeadIntake } from './useLeadIntake';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useLeadIntake', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries pending rows newest-first', async () => {
    order.mockResolvedValue({
      data: [{ id: 'i1', status: 'pending', email: 'a@b.gr', matched_on: ['email'], matches: [] }],
      error: null,
    });
    const { result } = renderHook(() => useLeadIntake(), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('lead_intake');
    expect(eq).toHaveBeenCalledWith('status', 'pending');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result.current.data?.[0]?.id).toBe('i1');
  });
});
