import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/fetchAllPages';

/**
 * Collected MRR: recurring-monthly income actually RECEIVED in the range —
 * paid rows attributed by the ledger's event_date (Athens-local paid date),
 * summed NET. Owner decision 2026-09-09 (report audit, decision 1): the tile
 * caption promises «εισπράχθηκαν στην περίοδο», so the figure now measures
 * receipts, not billing-period overlap, and matches the P&L month attribution.
 */
export function useMRR(range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['accounting-mrr', range.from, range.to] as const,
    queryFn: async (): Promise<number> => {
      const rows = await fetchAllPages(() =>
        supabase
          .from('accounting_ledger_v')
          .select('source_id, amount_net, event_date, status, billing_type, direction')
          .eq('direction', 'in')
          .eq('billing_type', 'recurring_monthly')
          .eq('status', 'paid')
          .gte('event_date', range.from)
          .lte('event_date', range.to)
          .order('source_id', { ascending: true }),
      );
      return (rows as { amount_net: number | null }[]).reduce(
        (s, r) => s + Number(r.amount_net ?? 0),
        0,
      );
    },
  });
}
