import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type RpcResult = { ok: boolean; errors?: string[] };

/** Επαναφορά αρχειοθετημένου job — μόνο admin (ο server το επιβάλλει επίσης). */
export function useUnarchiveJob(jobId: string, serviceType: string) {
  const qc = useQueryClient();
  return useMutation<RpcResult, Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('unarchive_job' as never, {
        p_job_id: jobId,
      } as never);
      if (error) throw new Error(error.message);
      const result = data as unknown as RpcResult;
      if (!result?.ok) throw new Error(result?.errors?.[0] ?? 'unarchive_failed');
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.archivedJobsByService(serviceType) });
      void qc.invalidateQueries({ queryKey: queryKeys.jobsByService(serviceType) });
      void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
    },
  });
}
