import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/fetchAllPages';

/**
 * Contracted MRR: monthly recurring jobs at face value plus yearly jobs at
 * 1/12 of their annual amount. The figure lives in jobs.amount_net (the
 * universal amount column; for yearly jobs it holds the ANNUAL price). Mirrors
 * the "Monthly recurring" total on the Accounting → Recurring page; the amount
 * actually collected in a period is a separate number (see useMRR).
 */
export function monthlyEquivalent(billingType: string, amount: number | null): number {
  const n = Number(amount) || 0;
  return billingType === 'recurring_yearly' ? n / 12 : n;
}

export function useContractedMRR() {
  return useQuery({
    queryKey: ['accounting-contracted-mrr'] as const,
    queryFn: async (): Promise<number> => {
      const rows = await fetchAllPages(() =>
        supabase
          .from('jobs')
          .select('id, amount_net, billing_type, clients!inner(archived)')
          .eq('status', 'active')
          .eq('archived', false)
          .neq('billing_type', 'one_time')
          .eq('clients.archived', false)
          .order('id', { ascending: true }),
      );
      return (rows as unknown as { amount_net: number | null; billing_type: string }[]).reduce(
        (s, r) => s + monthlyEquivalent(r.billing_type, r.amount_net),
        0,
      );
    },
  });
}
