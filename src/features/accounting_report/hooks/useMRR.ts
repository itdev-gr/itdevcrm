import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/fetchAllPages';

export function useMRR(range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['accounting-mrr', range.from, range.to] as const,
    queryFn: async (): Promise<number> => {
      const rows = await fetchAllPages(() =>
        supabase
          .from('deal_payments')
          .select('id, amount_gross, start_date, end_date, status, billing_type')
          .eq('billing_type', 'recurring_monthly')
          .eq('status', 'paid')
          .lte('start_date', range.to)
          .gte('end_date', range.from)
          .order('id', { ascending: true }),
      );
      return (rows as { amount_gross: number | null }[]).reduce(
        (s, r) => s + Number(r.amount_gross ?? 0),
        0,
      );
    },
  });
}
