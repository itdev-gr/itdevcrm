import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { jobsBillingKey } from './useJobsBilling';
import { dealPaymentsKey } from './useDealPayments';

type RpcResult = { ok: boolean; errors?: string[]; unpaid_total?: number; notified?: number };

/** Ανεξόφλητο (pending+overdue, με ΦΠΑ) της υπηρεσίας — για την προειδοποίηση. */
export function useJobUnpaidTotal(jobId: string, enabled: boolean): { unpaid: number | null } {
  const query = useQuery({
    queryKey: ['job-unpaid-total', jobId],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('job_unpaid_total' as never, {
        p_job_id: jobId,
      } as never);
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
  });
  return { unpaid: query.data ?? null };
}

/** End = λήξη ΚΑΙ αρχειοθέτηση, σε μία δοσοληψία στον server. */
export function useEndArchiveJob(dealId: string) {
  const qc = useQueryClient();
  return useMutation<RpcResult, Error, string>({
    mutationFn: async (jobId) => {
      const { data, error } = await supabase.rpc('end_and_archive_job' as never, {
        p_job_id: jobId,
      } as never);
      if (error) throw new Error(error.message);
      const result = data as unknown as RpcResult;
      if (!result?.ok) throw new Error(result?.errors?.[0] ?? 'end_archive_failed');
      return result;
    },
    onSuccess: () => {
      // The panel's own job list keys on `jobs-billing` (useJobsBilling), not
      // on queryKeys.jobsForDeal — invalidate both so every deal-page view of
      // the jobs list (billing panel + JobsTab) drops the now-archived job.
      void qc.invalidateQueries({ queryKey: jobsBillingKey(dealId) });
      void qc.invalidateQueries({ queryKey: dealPaymentsKey(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.jobsForDeal(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.notifications() });
    },
  });
}
