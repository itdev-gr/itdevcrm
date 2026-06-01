import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useMRR(range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['accounting-mrr', range.from, range.to] as const,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('deal_payments')
        .select('amount_gross, start_date, end_date, status, billing_type')
        .eq('billing_type', 'recurring_monthly')
        .eq('status', 'paid')
        .lte('start_date', range.to)
        .gte('end_date', range.from);
      if (error) throw new Error(error.message);
      return ((data ?? []) as { amount_gross: number | null }[]).reduce(
        (s, r) => s + Number(r.amount_gross ?? 0),
        0,
      );
    },
  });
}
