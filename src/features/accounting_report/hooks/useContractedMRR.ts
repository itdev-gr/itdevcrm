import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Contracted MRR: the sum of monthly amounts across active recurring jobs of
 * non-archived clients. Mirrors the "Monthly recurring" total on the
 * Accounting → Recurring page so the two screens always agree; the amount
 * actually collected in a period is a separate number (see useMRR).
 */
export function useContractedMRR() {
  return useQuery({
    queryKey: ['accounting-contracted-mrr'] as const,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('jobs')
        .select('monthly_amount, clients!inner(archived)')
        .eq('status', 'active')
        .eq('archived', false)
        .neq('billing_type', 'one_time')
        .eq('clients.archived', false);
      if (error) throw new Error(error.message);
      return ((data ?? []) as { monthly_amount: number | null }[]).reduce(
        (s, r) => s + (Number(r.monthly_amount) || 0),
        0,
      );
    },
  });
}
