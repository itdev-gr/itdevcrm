import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reengageLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useReengageLeadIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'reengage', async (input: { id: string; targetLeadId: string }) => {
      const r = await reengageLeadIntake(input.id, input.targetLeadId);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onError: (e: unknown) => window.alert(e instanceof Error ? e.message : String(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
