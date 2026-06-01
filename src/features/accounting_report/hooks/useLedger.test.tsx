import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, lte, gte, select, from } = vi.hoisted(() => {
  const order = vi.fn();
  const lte = vi.fn();
  const gte = vi.fn();
  const chain: Record<string, unknown> = { gte, lte, order };
  gte.mockReturnValue(chain);
  lte.mockReturnValue(chain);
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return { order, lte, gte, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useLedger } from './useLedger';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useLedger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries accounting_ledger_v in the given range, ordered desc', async () => {
    order.mockResolvedValue({
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
    expect(result.current.data).toHaveLength(2);
  });
});
