import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type DealJob = {
  id: string;
  code: string | null;
  service_type: string;
  details: Record<string, unknown> | null;
};

export function useDealJobs(dealId: string) {
  return useQuery({
    queryKey: ['deal-jobs', dealId] as const,
    enabled: !!dealId,
    queryFn: async (): Promise<DealJob[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, code, service_type, details')
        .eq('deal_id', dealId)
        .eq('archived', false);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DealJob[];
    },
  });
}
