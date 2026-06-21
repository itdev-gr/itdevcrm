import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { mergeLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useMergeLeadIntake() {
  const qc = useQueryClient();
  const { t } = useTranslation();
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
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
      if (res && 'dropped_dead_end' in res && res.dropped_dead_end) {
        window.alert(t('leads:intake.merge_removed_dead_end'));
      }
    },
  });
}
