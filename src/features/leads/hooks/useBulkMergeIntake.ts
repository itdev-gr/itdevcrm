import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bulkMergeIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useBulkMergeIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'bulk_merge', async () => {
      const r = await bulkMergeIntake();
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
