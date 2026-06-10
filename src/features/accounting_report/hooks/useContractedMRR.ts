import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Contracted MRR: monthly recurring jobs at face value plus yearly jobs at
 * 1/12 of their annual amount (yearly jobs store the ANNUAL price in
 * monthly_amount). Mirrors the "Monthly recurring" total on the Accounting →
 * Recurring page so the two screens always agree; the amount actually
 * collected in a period is a separate number (see useMRR).
 */
export function monthlyEquivalent(billingType: string, amount: number | null): number {
  const n = Number(amount) || 0;
  return billingType === 'recurring_yearly' ? n / 12 : n;
}

export function useContractedMRR() {
  return useQuery({
    queryKey: ['accounting-contracted-mrr'] as const,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('jobs')
        .select('monthly_amount, billing_type, clients!inner(archived)')
        .eq('status', 'active')
        .eq('archived', false)
        .neq('billing_type', 'one_time')
        .eq('clients.archived', false);
      if (error) throw new Error(error.message);
      return (
        (data ?? []) as { monthly_amount: number | null; billing_type: string }[]
      ).reduce((s, r) => s + monthlyEquivalent(r.billing_type, r.monthly_amount), 0);
    },
  });
}
