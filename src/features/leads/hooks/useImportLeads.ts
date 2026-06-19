import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importLeadsToIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { ImportedLeadRow } from '../leadImport';

export function useImportLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'import', async (rows: ImportedLeadRow[]) => {
      const r = await importLeadsToIntake(rows);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
    },
  });
}
