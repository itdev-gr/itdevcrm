import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

/** ALL of the deal's jobs for a given service (a deal can hold several web_dev
 *  jobs — one per website) — used to send technical users to the jobs they can
 *  access instead of the deal page they can't. Oldest first. */
export function useDealServiceJobs(
  dealId: string | null,
  serviceType: string | null | undefined,
  enabled: boolean,
) {
  return useQuery<{ id: string; code: string | null }[]>({
    queryKey: queryKeys.dealServiceJobs(dealId, serviceType),
    enabled: enabled && !!dealId && !!serviceType,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, code')
        .eq('deal_id', dealId!)
        .eq('service_type', serviceType!)
        .eq('archived', false)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; code: string | null }[];
    },
  });
}
