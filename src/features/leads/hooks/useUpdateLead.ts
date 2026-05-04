import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { id: string; patch: LeadUpdate }>({
    mutationFn: captureMutation('leads', 'update', async ({ id, patch }: { id: string; patch: LeadUpdate }) => {
      const { error } = await supabase.from('leads').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
      void qc.invalidateQueries({ queryKey: queryKeys.lead(vars.id) });
    },
  });
}
