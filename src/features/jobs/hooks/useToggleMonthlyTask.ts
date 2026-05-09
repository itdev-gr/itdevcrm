import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = { jobId: string; code: string; completed: boolean };

export function useToggleMonthlyTask(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation(
      'jobs',
      'toggle_monthly_task',
      async ({ jobId: id, code, completed }: Input) => {
        const { error } = await supabase.rpc('set_job_monthly_task', {
          p_job_id: id,
          p_code: code,
          p_completed: completed,
        });
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobMonthlyTasks(jobId) });
      void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
    },
  });
}
