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

function periodOf(iso: string): string {
  return iso.slice(0, 7);
}

export function usePLSummary(range: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.accountingPLSummary(range.from, range.to),
    queryFn: async (): Promise<PLSummary> => {
      const { data, error } = await supabase
        .from('accounting_pl_summary_v')
        .select('*')
        .gte('period', periodOf(range.from))
        .lte('period', periodOf(range.to));
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Record<string, number | string>[];
      const sum = (key: string) =>
        rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);
      return {
        totalIncomeNet: sum('total_income_net'),
        totalIncomeVat: sum('total_income_vat'),
        totalIncomeGross: sum('total_income_gross'),
        totalExpenseNet: sum('total_expense_net'),
        totalExpenseVat: sum('total_expense_vat'),
        totalExpenseGross: sum('total_expense_gross'),
        netProfitNet: sum('net_profit_net'),
        netProfitGross: sum('net_profit_gross'),
      };
    },
  });
}
