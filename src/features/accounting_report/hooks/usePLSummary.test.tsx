import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { usePLSummary } from './usePLSummary';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(c: ReactNode, qc: QueryClient = makeClient()) {
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

// The RPC row as PostgREST returns it — Postgres numeric arrives as STRING.
const RPC_ROW = {
  total_income_net: '1500.00',
  total_income_vat: '360.00',
  total_income_gross: '1860.00',
  total_expense_net: 600,
  total_expense_vat: 144,
  total_expense_gross: 744,
  net_profit_net: '900.00',
  net_profit_gross: '1116.00',
  income_rows: 2,
  expense_rows: 2,
};

describe('usePLSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates aggregation to pl_summary_for_range and coerces numeric strings', async () => {
    // Aggregation moved server-side (migration 20260827150000) so it can never
    // be truncated by PostgREST's 1000-row page — the hook only maps one row.
    rpc.mockResolvedValue({ data: [RPC_ROW], error: null });
    const { result } = renderHook(
      () => usePLSummary({ from: '2026-07-01', to: '2026-07-16' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('pl_summary_for_range', {
      p_from: '2026-07-01',
      p_to: '2026-07-16',
      p_include_pending_expenses: false,
    });
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

  it('passes the include-pending-expenses flag through to the RPC', async () => {
    rpc.mockResolvedValue({ data: [RPC_ROW], error: null });
    const { result } = renderHook(
      () => usePLSummary({ from: '2026-07-01', to: '2026-07-31' }, { includePendingExpenses: true }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('pl_summary_for_range', {
      p_from: '2026-07-01',
      p_to: '2026-07-31',
      p_include_pending_expenses: true,
    });
  });

  it('handles a bare-object RPC response and missing fields as zeros', async () => {
    rpc.mockResolvedValue({ data: [{}], error: null });
    const { result } = renderHook(
      () => usePLSummary({ from: '2026-01-01', to: '2026-01-31' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalIncomeNet).toBe(0);
    expect(result.current.data?.netProfitNet).toBe(0);
  });

  it('query key differs between flag ON and OFF (caches must not collide)', async () => {
    rpc.mockResolvedValue({ data: [RPC_ROW], error: null });
    const qc = makeClient();
    const off = renderHook(
      () => usePLSummary({ from: '2026-07-01', to: '2026-07-31' }),
      { wrapper: ({ children }) => wrap(children, qc) },
    );
    const on = renderHook(
      () => usePLSummary({ from: '2026-07-01', to: '2026-07-31' }, { includePendingExpenses: true }),
      { wrapper: ({ children }) => wrap(children, qc) },
    );
    await waitFor(() => expect(off.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    // Two distinct cache entries → the RPC ran once per flag value.
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
