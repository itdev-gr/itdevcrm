import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** The deal's job for a given service (e.g. the web_dev job of a deal) — used to send
 *  technical users to the job they can access instead of the deal page they can't.
 *  Returns null when there's no such job (or the lookup is disabled). */
export function useDealServiceJob(
  dealId: string | null,
  serviceType: string | null | undefined,
  enabled: boolean,
) {
  return useQuery<{ id: string; code: string | null } | null>({
    queryKey: ['deal-service-job', dealId, serviceType],
    enabled: enabled && !!dealId && !!serviceType,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, code')
        .eq('deal_id', dealId!)
        .eq('service_type', serviceType!)
        .eq('archived', false)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as { id: string; code: string | null } | null;
    },
  });
}
