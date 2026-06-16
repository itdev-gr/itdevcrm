import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export function useBulkUpdateLeads() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { ids: string[]; patch: LeadUpdate }>({
    mutationFn: captureMutation('leads', 'bulk_update', async ({ ids, patch }) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('leads').update(patch).in('id', ids);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
