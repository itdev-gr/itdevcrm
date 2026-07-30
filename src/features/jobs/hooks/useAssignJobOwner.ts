import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Assign (or clear) a job's owner from a list view. Writes `jobs.owner_user_id`
 * directly — the same path the job detail page's Owner dropdown uses; RLS
 * (`jobs_update_accounting` / `jobs_mutate_admin_or_service`) covers the
 * accounting + admin users who get the picker. The caller passes the query
 * keys to refresh (its own list scope + the affected kanban board); the job's
 * own detail query is always invalidated.
 */
export function useAssignJobOwner() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { jobId: string; ownerUserId: string | null; invalidate?: QueryKey[] }
  >({
    mutationFn: async ({ jobId, ownerUserId }) => {
      const { error } = await supabase
        .from('jobs')
        .update({ owner_user_id: ownerUserId || null } as never)
        .eq('id', jobId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, { jobId, invalidate }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
      for (const key of invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
    },
  });
}
