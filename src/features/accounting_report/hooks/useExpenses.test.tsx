import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, ilike, gte, lte, eq, select, from } = vi.hoisted(() => {
  const order = vi.fn();
  const lte = vi.fn();
  const gte = vi.fn();
  const ilike = vi.fn();
  const eq = vi.fn();
  const chain: Record<string, unknown> = { eq, ilike, gte, lte, order };
  eq.mockReturnValue(chain);
  ilike.mockReturnValue(chain);
  gte.mockReturnValue(chain);
  lte.mockReturnValue(chain);
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return { order, ilike, gte, lte, eq, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useExpenses } from './useExpenses';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useExpenses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('composes filters and orders by start_date desc', async () => {
    order.mockResolvedValue({
      data: [{ id: 'e1', vendor: 'Adobe', amount_net: 50, amount_gross: 62, status: 'paid' }],
      error: null,
    });
    const { result } = renderHook(
      () =>
        useExpenses({
          status: 'paid',
          categoryId: 'cat-1',
          vendor: 'ado',
          from: '2026-06-01',
          to: '2026-06-30',
        }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('expenses');
    expect(eq).toHaveBeenCalledWith('status', 'paid');
    expect(eq).toHaveBeenCalledWith('category_id', 'cat-1');
    expect(ilike).toHaveBeenCalledWith('vendor', '%ado%');
    expect(gte).toHaveBeenCalledWith('start_date', '2026-06-01');
    expect(lte).toHaveBeenCalledWith('start_date', '2026-06-30');
    expect(order).toHaveBeenCalledWith('start_date', { ascending: false });
    expect(result.current.data?.[0].vendor).toBe('Adobe');
  });
});
