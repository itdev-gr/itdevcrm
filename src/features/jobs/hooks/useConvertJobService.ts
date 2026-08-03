import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { JobRow } from './useJobs';

export function useConvertJobService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, target }: { jobId: string; target: string }): Promise<JobRow> => {
      const { data, error } = await supabase.rpc('convert_job_service_type', {
        p_job_id: jobId,
        p_target: target,
      });
      if (error) throw new Error(error.message);
      return data as unknown as JobRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['job'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
      // Refresh the deal's Jobs & Billing panel (prefix keys, any deal).
      qc.invalidateQueries({ queryKey: ['jobs-billing'] });
      qc.invalidateQueries({ queryKey: ['deal-payments'] });
    },
  });
}
