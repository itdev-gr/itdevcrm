import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type LedgerRow = {
  direction: 'in' | 'out';
  event_date: string;
  period: string;
  status: 'pending' | 'paid';
  amount_net: number;
  vat_amount: number;
  amount_gross: number;
  category_key: string | null;
  counterparty: string | null;
  billing_type: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  source_table: 'deal_payments' | 'expenses';
  source_id: string;
};

export function useLedger(range: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.accountingLedger(range.from, range.to),
    queryFn: async (): Promise<LedgerRow[]> => {
      const { data, error } = await supabase
        .from('accounting_ledger_v')
        .select('*')
        .gte('event_date', range.from)
        .lte('event_date', range.to)
        .order('event_date', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as LedgerRow[];
    },
  });
}
