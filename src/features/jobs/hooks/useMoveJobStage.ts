import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { JobRow, ServiceType } from './useJobs';

export function useMoveJobStage(serviceType: ServiceType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, stageId }: { jobId: string; stageId: string }) => {
      const { error } = await supabase
        .from('jobs')
        .update({ stage_id: stageId })
        .eq('id', jobId);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ jobId, stageId }) => {
      await qc.cancelQueries({ queryKey: queryKeys.jobsByService(serviceType) });
      const previous = qc.getQueriesData<JobRow[]>({
        queryKey: queryKeys.jobsByService(serviceType),
      });
      previous.forEach(([key, value]) => {
        if (!value) return;
        qc.setQueryData<JobRow[]>(
          key,
          value.map((j) => (j.id === jobId ? { ...j, stage_id: stageId } : j)),
        );
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobsByService(serviceType) });
    },
  });
}
