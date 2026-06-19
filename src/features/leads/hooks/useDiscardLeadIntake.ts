import { useMutation, useQueryClient } from '@tanstack/react-query';
import { discardLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDiscardLeadIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'discard', async (id: string) => {
      const r = await discardLeadIntake(id);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
    },
  });
}
