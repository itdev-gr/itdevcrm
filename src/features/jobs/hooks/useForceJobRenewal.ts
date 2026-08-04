import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { JobRow } from './useJobs';

// Manual "Send to Renewal" — the RPC stamps jobs.renewed_for_period through the
// stage trigger, so the automatic mover will not act again for the same cycle.
export function useForceJobRenewal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string): Promise<JobRow> => {
      const { data, error } = await supabase.rpc('force_job_renewal', { p_job_id: jobId });
      if (error) throw new Error(error.message);
      return data as unknown as JobRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['job'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}
