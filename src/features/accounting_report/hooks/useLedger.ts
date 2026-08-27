import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { fetchAllPages } from '@/lib/fetchAllPages';

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
  deal_id: string | null;
  deal_code: string | null;
};

export function useLedger(range: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.accountingLedger(range.from, range.to),
    queryFn: async (): Promise<LedgerRow[]> => {
      // Paged drain: the ledger is past PostgREST's 1000-row page, and an
      // unranged select silently truncates. source_id is the tiebreaker so
      // pages never skip/duplicate rows that share an event_date.
      const rows = await fetchAllPages(() =>
        supabase
          .from('accounting_ledger_v')
          .select('*')
          .gte('event_date', range.from)
          .lte('event_date', range.to)
          .order('event_date', { ascending: false })
          .order('source_id', { ascending: true }),
      );
      return rows as LedgerRow[];
    },
  });
}
