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

  it('aggregates rows in range into totals', async () => {
    lte.mockResolvedValue({
      data: [
        { period: '2026-06',
          total_income_net: 1000, total_income_vat: 240, total_income_gross: 1240,
          total_expense_net: 400, total_expense_vat: 96, total_expense_gross: 496,
          net_profit_net: 600, net_profit_gross: 744 },
        { period: '2026-07',
          total_income_net: 500, total_income_vat: 120, total_income_gross: 620,
          total_expense_net: 200, total_expense_vat: 48, total_expense_gross: 248,
          net_profit_net: 300, net_profit_gross: 372 },
      ],
      error: null,
    });
    const { result } = renderHook(
      () => usePLSummary({ from: '2026-06-01', to: '2026-07-31' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(gte).toHaveBeenCalledWith('period', '2026-06');
    expect(lte).toHaveBeenCalledWith('period', '2026-07');
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
