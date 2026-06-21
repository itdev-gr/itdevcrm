import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mergeLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useMergeLeadIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation(
      'lead_intake',
      'merge',
      async (input: { id: string; targetLeadId: string }) => {
        const r = await mergeLeadIntake(input.id, input.targetLeadId);
        if (!r.ok) throw new Error(r.errors.join(', '));
        return r;
      },
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
