import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { JobRow, ServiceType } from './useJobs';
import { captureMutation } from '@/lib/sentry/captureMutation';

type MoveVars = {
  jobId: string;
  stageId: string;
  /**
   * true when the target stage is terminal with outcome 'completed' (stamps
   * completed_at), false to clear it; omit to leave completed_at untouched.
   */
  completed?: boolean;
};

export function useMoveJobStage(serviceType: ServiceType) {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, MoveVars, { previous: [readonly unknown[], JobRow[] | undefined][] }>({
    mutationFn: captureMutation('jobs', 'move_stage', async ({ jobId, stageId, completed }: MoveVars) => {
      const { error } = await supabase
        .from('jobs')
        .update({
          stage_id: stageId,
          ...(completed !== undefined
            ? { completed_at: completed ? new Date().toISOString() : null }
            : {}),
        })
        .eq('id', jobId);
      if (error) throw new Error(error.message);
    }),
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
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobsByService(serviceType) });
      // Also refresh the single-job query so the job detail page reflects the
      // move immediately (the board query alone doesn't back that page).
      void qc.invalidateQueries({ queryKey: queryKeys.job(vars.jobId) });
    },
  });
}
