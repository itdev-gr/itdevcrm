import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { closeDeal, type CloseDealJob } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useCloseDeal() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true; deal_id: string; closed_jobs: number },
    DefaultError,
    { dealId: string; jobs: CloseDealJob[] }
  >({
    mutationFn: captureMutation('accounting', 'close_deal', async ({ dealId, jobs }) => {
      const r = await closeDeal(dealId, jobs);
      if (!r.ok) throw new Error((r.errors ?? ['close_failed']).join(', '));
      return r;
    }),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      void qc.invalidateQueries({ queryKey: queryKeys.jobsForDeal(vars.dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(vars.dealId) });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
