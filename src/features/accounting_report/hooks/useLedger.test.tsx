import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, lte, gte, range, from } = vi.hoisted(() => {
  const range = vi.fn();
  const order = vi.fn();
  const lte = vi.fn();
  const gte = vi.fn();
  const chain: Record<string, unknown> = { gte, lte, order, range };
  gte.mockReturnValue(chain);
  lte.mockReturnValue(chain);
  order.mockReturnValue(chain);
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return { order, lte, gte, range, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useLedger } from './useLedger';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useLedger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries accounting_ledger_v in the given range, ordered and paged', async () => {
    range.mockResolvedValue({
      data: [
        { direction: 'in', event_date: '2026-06-10', amount_gross: 124, status: 'paid' },
        { direction: 'out', event_date: '2026-06-12', amount_gross: 50, status: 'paid' },
      ],
      error: null,
    });
    const { result } = renderHook(
      () => useLedger({ from: '2026-06-01', to: '2026-06-30' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('accounting_ledger_v');
    expect(gte).toHaveBeenCalledWith('event_date', '2026-06-01');
    expect(lte).toHaveBeenCalledWith('event_date', '2026-06-30');
    expect(order).toHaveBeenCalledWith('event_date', { ascending: false });
    // Deterministic tiebreaker so pages can never skip/duplicate rows.
    expect(order).toHaveBeenCalledWith('source_id', { ascending: true });
    // Paged drain (audit E22): the fetch goes through .range, page size 1000.
    expect(range).toHaveBeenCalledWith(0, 999);
    expect(result.current.data).toHaveLength(2);
  });

  it('keeps fetching pages until a short page arrives (past the 1000-row cap)', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      direction: 'in',
      event_date: '2026-06-10',
      amount_gross: 1,
      status: 'paid',
      source_id: `row-${i}`,
    }));
    range
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: [{ direction: 'out', event_date: '2026-06-11', amount_gross: 2, status: 'paid', source_id: 'tail' }], error: null });
    const { result } = renderHook(
      () => useLedger({ from: '2026-06-01', to: '2026-06-30' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(range).toHaveBeenCalledWith(0, 999);
    expect(range).toHaveBeenCalledWith(1000, 1999);
    expect(result.current.data).toHaveLength(1001);
  });
});
