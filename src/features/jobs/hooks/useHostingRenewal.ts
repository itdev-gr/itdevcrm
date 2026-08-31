import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type HostingRenewalRow = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  paid_at: string | null;
};

/** The hosting chain's HEAD payment (newest non-cancelled row by end_date) —
 *  its end_date is the renewal anniversary future renewals chain from. */
export function useHostingRenewalPayment(dealId: string | null) {
  return useQuery({
    queryKey: ['hosting-renewal-payment', dealId],
    enabled: !!dealId,
    staleTime: 30_000,
    queryFn: async (): Promise<HostingRenewalRow | null> => {
      const { data, error } = await supabase
        .from('deal_payments')
        .select('id, start_date, end_date, status, paid_at')
        .eq('deal_id', dealId!)
        .eq('service_type', 'hosting')
        .neq('status', 'cancelled')
        .order('end_date', { ascending: false, nullsFirst: false })
        .limit(1);
      if (error) throw new Error(error.message);
      return (data?.[0] as HostingRenewalRow | undefined) ?? null;
    },
  });
}
