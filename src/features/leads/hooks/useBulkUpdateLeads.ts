import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { applyLeadPatch } from './useUpdateLead';

type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export function useBulkUpdateLeads() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { ids: string[]; patch: LeadUpdate }>({
    mutationFn: captureMutation('leads', 'bulk_update', async ({ ids, patch }) => {
      await applyLeadPatch(ids, patch);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
