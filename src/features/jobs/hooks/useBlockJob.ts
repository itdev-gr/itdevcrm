import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useBlockJob(jobId: string) {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { reason?: string }>({
    mutationFn: captureMutation('jobs', 'block', async ({ reason }: { reason?: string }) => {
      const { data, error } = await supabase.rpc('block_job', {
        target_job_id: jobId,
        reason: reason ?? 'manual',
      });
      if (error) throw new Error(error.message);
      const result = data as { ok: boolean; errors?: string[] };
      if (!result.ok) throw new Error((result.errors ?? ['unknown_error']).join(', '));
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useUnblockJob(jobId: string) {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, void>({
    mutationFn: captureMutation('jobs', 'unblock', async (_: void) => {
      const { data, error } = await supabase.rpc('unblock_job', { target_job_id: jobId });
      if (error) throw new Error(error.message);
      const result = data as { ok: boolean; errors?: string[] };
      if (!result.ok) throw new Error((result.errors ?? ['unknown_error']).join(', '));
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
