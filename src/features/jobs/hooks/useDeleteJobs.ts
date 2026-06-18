import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteJobs } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDeleteJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('jobs', 'delete', async (ids: string[]) => {
      const r = await deleteJobs(ids);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r; // { ok: true, deletedCount }
    }),
    onSuccess: () => {
      // ['jobs'] prefix refreshes every board/list query:
      // ['jobs','service',…], ['jobs','deal',…], ['jobs','client',…].
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
