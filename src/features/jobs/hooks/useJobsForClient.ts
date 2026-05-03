import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { JobRow } from './useJobs';

export function useJobsForClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.jobsForClient(clientId),
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(
          '*, deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
        .eq('client_id', clientId)
        .eq('archived', false)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as JobRow[];
    },
    enabled: !!clientId,
  });
}
