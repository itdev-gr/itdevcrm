import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { lte, gte, from } = vi.hoisted(() => {
  const lte = vi.fn();
  const gte = vi.fn();
  gte.mockReturnValue({ lte });
  const select = vi.fn().mockReturnValue({ gte });
  const from = vi.fn().mockReturnValue({ select });
  return { lte, gte, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { usePLSummary } from './usePLSummary';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('usePLSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates exact-date-filtered ledger rows into paid-only totals', async () => {
    // Ledger rows spanning paid/pending and in/out. Postgres numeric comes back
    // as STRING over supabase-js — mix strings and numbers to exercise Number().
    lte.mockResolvedValue({
      data: [
        // income, paid — counted
        { direction: 'in', status: 'paid', amount_net: 1000, vat_amount: 240, amount_gross: 1240 },
        { direction: 'in', status: 'paid', amount_net: '500', vat_amount: '120', amount_gross: '620' },
        // income, pending — excluded
        { direction: 'in', status: 'pending', amount_net: 999, vat_amount: 999, amount_gross: 999 },
        // expense, paid — counted
        { direction: 'out', status: 'paid', amount_net: 400, vat_amount: 96, amount_gross: 496 },
        { direction: 'out', status: 'paid', amount_net: '200', vat_amount: '48', amount_gross: '248' },
        // expense, pending — excluded
        { direction: 'out', status: 'pending', amount_net: 777, vat_amount: 777, amount_gross: 777 },
      ],
      error: null,
    });
    const { result } = renderHook(
      () => usePLSummary({ from: '2026-07-01', to: '2026-07-16' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Reads the ledger view, filtered by EXACT event_date (same as useLedger).
    expect(from).toHaveBeenCalledWith('accounting_ledger_v');
    expect(gte).toHaveBeenCalledWith('event_date', '2026-07-01');
    expect(lte).toHaveBeenCalledWith('event_date', '2026-07-16');

    // Hand-computed, paid-only:
    //   income  net 1000+500=1500, vat 240+120=360, gross 1240+620=1860
    //   expense net 400+200=600,   vat 96+48=144,   gross 496+248=744
    //   net profit net 1500-600=900, gross 1860-744=1116
    expect(result.current.data).toEqual({
      totalIncomeNet: 1500,
      totalIncomeVat: 360,
      totalIncomeGross: 1860,
      totalExpenseNet: 600,
      totalExpenseVat: 144,
      totalExpenseGross: 744,
      netProfitNet: 900,
      netProfitGross: 1116,
    });
  });
});
