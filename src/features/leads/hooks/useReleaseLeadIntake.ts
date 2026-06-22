import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { releaseLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useReleaseLeadIntake() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'release', async (input: { id: string; force?: boolean }) => {
      const r = await releaseLeadIntake(input.id, input.force ?? false);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(msg.includes('has_duplicates') ? t('leads:intake.release_reflagged') : msg);
    },
    onSettled: () => {
      // Invalidate regardless of outcome: a `has_duplicates` refusal refreshes
      // the stored matches server-side, so re-fetching reveals the new flags.
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
