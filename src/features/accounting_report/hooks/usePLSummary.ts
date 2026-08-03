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

// Only the columns needed to replicate accounting_pl_summary_v's aggregation.
// Postgres numeric comes back as STRING over supabase-js — coerce with Number().
type LedgerAggRow = {
  direction: 'in' | 'out';
  status: 'pending' | 'paid';
  amount_net: number | string | null;
  vat_amount: number | string | null;
  amount_gross: number | string | null;
};

export function usePLSummary(
  range: { from: string; to: string },
  opts?: { includePendingExpenses?: boolean },
) {
  const includePendingExpenses = opts?.includePendingExpenses ?? false;
  return useQuery({
    queryKey: queryKeys.accountingPLSummary(range.from, range.to, includePendingExpenses),
    queryFn: async (): Promise<PLSummary> => {
      // Derive from the SAME exact-date-filtered ledger rows as useLedger, so the
      // header cards always agree with the breakdown tables / PDF / CSV export for
      // ANY range (previously the cards read whole-MONTH totals via period filter).
      const { data, error } = await supabase
        .from('accounting_ledger_v')
        .select('direction, status, amount_net, vat_amount, amount_gross')
        .gte('event_date', range.from)
        .lte('event_date', range.to);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as LedgerAggRow[];

      // Replicates accounting_pl_summary_v (cash basis) by default:
      //   income  = direction='in'  AND status='paid'
      //   expense = direction='out' AND status='paid'
      //   net profit = income - expense (net & gross)
      // Opt-in: when includePendingExpenses, pending EXPENSES also count
      // (income stays paid-only — never counts pending income).
      const s: PLSummary = {
        totalIncomeNet: 0,
        totalIncomeVat: 0,
        totalIncomeGross: 0,
        totalExpenseNet: 0,
        totalExpenseVat: 0,
        totalExpenseGross: 0,
        netProfitNet: 0,
        netProfitGross: 0,
      };
      for (const r of rows) {
        const net = Number(r.amount_net ?? 0);
        const vat = Number(r.vat_amount ?? 0);
        const gross = Number(r.amount_gross ?? 0);
        if (r.direction === 'in') {
          if (r.status !== 'paid') continue; // income: paid-only, always
          s.totalIncomeNet += net;
          s.totalIncomeVat += vat;
          s.totalIncomeGross += gross;
        } else if (r.direction === 'out') {
          const counts =
            r.status === 'paid' || (includePendingExpenses && r.status === 'pending');
          if (!counts) continue;
          s.totalExpenseNet += net;
          s.totalExpenseVat += vat;
          s.totalExpenseGross += gross;
        }
      }
      s.netProfitNet = s.totalIncomeNet - s.totalExpenseNet;
      s.netProfitGross = s.totalIncomeGross - s.totalExpenseGross;
      return s;
    },
  });
}
