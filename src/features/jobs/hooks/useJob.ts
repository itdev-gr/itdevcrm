import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { notAccessibleError } from '@/lib/notAccessibleError';
import type { JobRow } from './useJobs';

export function useJob(jobId: string) {
  return useQuery({
    queryKey: queryKeys.job(jobId),
    queryFn: async (): Promise<JobRow> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(
          '*, client:clients(id, name, contact_first_name, contact_last_name, industry, email, phone, website, contact_info, additional_contacts), deal:deals(id, code, title, payment_method, first_paid_in_full_at), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
        .eq('id', jobId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw notAccessibleError();
      return data as unknown as JobRow;
    },
    enabled: !!jobId,
  });
}
