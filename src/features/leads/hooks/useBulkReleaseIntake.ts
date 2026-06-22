import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bulkReleaseIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useBulkReleaseIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'bulk_release', async () => {
      const r = await bulkReleaseIntake();
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
