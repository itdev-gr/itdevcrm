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

import { useOfferViews } from './useOfferViews';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useOfferViews', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts non-bot views and reports the newest', async () => {
    order.mockResolvedValue({
      data: [{ viewed_at: '2026-08-28T10:00:00Z' }, { viewed_at: '2026-08-27T09:00:00Z' }],
      error: null,
    });
    const { result } = renderHook(() => useOfferViews('offer-1'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('offer_views');
    expect(eq).toHaveBeenCalledWith('offer_id', 'offer-1');
    expect(eq).toHaveBeenCalledWith('suspected_bot', false);
    expect(result.current.data).toEqual({ count: 2, lastViewedAt: '2026-08-28T10:00:00Z' });
  });

  it('returns zero state when there are no views', async () => {
    order.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useOfferViews('offer-2'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ count: 0, lastViewedAt: null });
  });

  it('does not fetch without an offer id', () => {
    renderHook(() => useOfferViews(undefined), { wrapper: ({ children }) => wrap(children) });
    expect(from).not.toHaveBeenCalled();
  });
});
