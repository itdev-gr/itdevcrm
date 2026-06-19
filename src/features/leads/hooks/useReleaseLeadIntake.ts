import { useMutation, useQueryClient } from '@tanstack/react-query';
import { releaseLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useReleaseLeadIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'release', async (id: string) => {
      const r = await releaseLeadIntake(id);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
