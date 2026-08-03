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

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(c: ReactNode, qc: QueryClient = makeClient()) {
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

// Ledger rows shared by the include-pending-expenses tests: one paid + one
// pending on each side. Postgres numeric comes back as STRING over supabase-js.
const MIXED_ROWS = [
  { direction: 'in', status: 'paid', amount_net: 1000, vat_amount: 240, amount_gross: 1240 },
  { direction: 'in', status: 'pending', amount_net: 999, vat_amount: 999, amount_gross: 999 },
  { direction: 'out', status: 'paid', amount_net: 400, vat_amount: 96, amount_gross: 496 },
  { direction: 'out', status: 'pending', amount_net: '100', vat_amount: '24', amount_gross: '124' },
];

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

  it('flag OFF: pending expense is NOT counted (cash-basis default)', async () => {
    lte.mockResolvedValue({ data: MIXED_ROWS, error: null });
    const { result } = renderHook(
      () => usePLSummary({ from: '2026-07-01', to: '2026-07-31' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Only paid rows count: income 1000 / expense 400.
    expect(result.current.data).toEqual({
      totalIncomeNet: 1000,
      totalIncomeVat: 240,
      totalIncomeGross: 1240,
      totalExpenseNet: 400,
      totalExpenseVat: 96,
      totalExpenseGross: 496,
      netProfitNet: 600,
      netProfitGross: 744,
    });
  });

  it('flag ON: pending EXPENSE is counted and profit reflects it', async () => {
    lte.mockResolvedValue({ data: MIXED_ROWS, error: null });
    const { result } = renderHook(
      () =>
        usePLSummary(
          { from: '2026-07-01', to: '2026-07-31' },
          { includePendingExpenses: true },
        ),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Expense now = paid 400 + pending 100 = 500 (vat 96+24=120, gross 496+124=620).
    expect(result.current.data?.totalExpenseNet).toBe(500);
    expect(result.current.data?.totalExpenseVat).toBe(120);
    expect(result.current.data?.totalExpenseGross).toBe(620);
    // Profit drops by the pending expense: 1000-500=500 net, 1240-620=620 gross.
    expect(result.current.data?.netProfitNet).toBe(500);
    expect(result.current.data?.netProfitGross).toBe(620);
  });

  it('flag ON: pending INCOME is still NOT counted (income stays paid-only)', async () => {
    lte.mockResolvedValue({ data: MIXED_ROWS, error: null });
    const { result } = renderHook(
      () =>
        usePLSummary(
          { from: '2026-07-01', to: '2026-07-31' },
          { includePendingExpenses: true },
        ),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The pending income row (999) must never be added.
    expect(result.current.data?.totalIncomeNet).toBe(1000);
    expect(result.current.data?.totalIncomeVat).toBe(240);
    expect(result.current.data?.totalIncomeGross).toBe(1240);
  });

  it('query key differs between flag ON and OFF (caches must not collide)', async () => {
    lte.mockResolvedValue({ data: MIXED_ROWS, error: null });
    const qc = makeClient();
    const range = { from: '2026-07-01', to: '2026-07-31' };

    const off = renderHook(() => usePLSummary(range), {
      wrapper: ({ children }) => wrap(children, qc),
    });
    const on = renderHook(
      () => usePLSummary(range, { includePendingExpenses: true }),
      { wrapper: ({ children }) => wrap(children, qc) },
    );
    await waitFor(() => expect(off.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));

    // Two distinct cache entries — the flag is part of the key.
    const keys = qc.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
    expect(new Set(keys).size).toBe(2);
    // And the results differ (pending expense only in the ON entry).
    expect(off.result.current.data?.totalExpenseNet).toBe(400);
    expect(on.result.current.data?.totalExpenseNet).toBe(500);
  });
});
