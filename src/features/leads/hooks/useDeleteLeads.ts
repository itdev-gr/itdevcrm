import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteLeads } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDeleteLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('leads', 'delete', async (ids: string[]) => {
      const r = await deleteLeads(ids);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r; // { ok: true, deletedCount, skipped }
    }),
    onSuccess: () => {
      // ['leads'] prefix => refreshes both the list and the kanban (['leads','kanban',…]).
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
