import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { dealPaymentsKey } from '@/features/deals/hooks/useDealPayments';
import { captureMutation } from '@/lib/sentry/captureMutation';

// `.bind(supabase)` is required: supabase-js's `rpc()` reads `this.rest`, so a
// captured bare reference throws "Cannot read properties of undefined (reading
// 'rest')" before any request is sent.
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

type PauseResult = { ok: boolean; errors?: string[] } & Record<string, unknown>;

function invalidate(qc: ReturnType<typeof useQueryClient>, jobId: string, dealId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
  void qc.invalidateQueries({ queryKey: dealPaymentsKey(dealId) });
  void qc.invalidateQueries({ queryKey: ['jobs'] });
}

export function useJobPauseBilling(jobId: string, dealId: string) {
  const qc = useQueryClient();
  return useMutation<PauseResult, DefaultError, void>({
    mutationFn: captureMutation('jobs', 'pause_billing', async (_: void) => {
      const { data, error } = await rpc('job_pause_billing', { p_job_id: jobId });
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as PauseResult;
      if (!result.ok) throw new Error((result.errors ?? ['unknown_error']).join(', '));
      return result;
    }),
    onSuccess: () => invalidate(qc, jobId, dealId),
  });
}

export function useJobResumeBilling(jobId: string, dealId: string) {
  const qc = useQueryClient();
  return useMutation<PauseResult, DefaultError, void>({
    mutationFn: captureMutation('jobs', 'resume_billing', async (_: void) => {
      const { data, error } = await rpc('job_resume_billing', { p_job_id: jobId });
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as PauseResult;
      if (!result.ok) throw new Error((result.errors ?? ['unknown_error']).join(', '));
      return result;
    }),
    onSuccess: () => invalidate(qc, jobId, dealId),
  });
}
