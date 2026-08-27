import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type PLSummary = {
  totalIncomeNet: number;
  totalIncomeVat: number;
  totalIncomeGross: number;
  totalExpenseNet: number;
  totalExpenseVat: number;
  totalExpenseGross: number;
  netProfitNet: number;
  netProfitGross: number;
};

// Row shape of the pl_summary_for_range RPC (numerics arrive as strings).
type PLSummaryRow = {
  total_income_net: number | string | null;
  total_income_vat: number | string | null;
  total_income_gross: number | string | null;
  total_expense_net: number | string | null;
  total_expense_vat: number | string | null;
  total_expense_gross: number | string | null;
  net_profit_net: number | string | null;
  net_profit_gross: number | string | null;
};

export function usePLSummary(
  range: { from: string; to: string },
  opts?: { includePendingExpenses?: boolean },
) {
  const includePendingExpenses = opts?.includePendingExpenses ?? false;
  return useQuery({
    queryKey: queryKeys.accountingPLSummary(range.from, range.to, includePendingExpenses),
    queryFn: async (): Promise<PLSummary> => {
      // Aggregated in the database (pl_summary_for_range, 20260827150000):
      // an SQL aggregate cannot be row-capped, unlike the previous client-side
      // fetch-and-sum which silently lost every row past PostgREST's 1000-row
      // page (the YTD strip showed expenses €0.00 once the ledger grew).
      // Semantics unchanged: income counts paid rows only; expenses count paid
      // plus (opt-in) pending.
      const { data, error } = await supabase.rpc('pl_summary_for_range', {
        p_from: range.from,
        p_to: range.to,
        p_include_pending_expenses: includePendingExpenses,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as PLSummaryRow | undefined;
      const n = (v: number | string | null | undefined) => Number(v ?? 0);
      return {
        totalIncomeNet: n(row?.total_income_net),
        totalIncomeVat: n(row?.total_income_vat),
        totalIncomeGross: n(row?.total_income_gross),
        totalExpenseNet: n(row?.total_expense_net),
        totalExpenseVat: n(row?.total_expense_vat),
        totalExpenseGross: n(row?.total_expense_gross),
        netProfitNet: n(row?.net_profit_net),
        netProfitGross: n(row?.net_profit_gross),
      };
    },
  });
}
