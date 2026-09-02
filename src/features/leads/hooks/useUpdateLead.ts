import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type LeadUpdate = Database['public']['Tables']['leads']['Update'];

// Owner changes go through the reassign_leads RPC: on PG17 the own-only
// SELECT policy is enforced against the UPDATE's new row, so a rep handing
// their lead to someone else can never do it with a plain update.
export async function applyLeadPatch(ids: string[], patch: LeadUpdate): Promise<void> {
  if (ids.length === 0) return;
  const { owner_user_id, ...rest } = patch;
  if ('owner_user_id' in patch) {
    const { error } = await supabase.rpc('reassign_leads' as never, {
      p_lead_ids: ids,
      p_new_owner: owner_user_id ?? null,
    } as never);
    if (error) throw new Error(error.message);
  }
  if (Object.keys(rest).length > 0) {
    const { error } = await supabase.from('leads').update(rest).in('id', ids);
    if (error) throw new Error(error.message);
  }
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { id: string; patch: LeadUpdate }>({
    mutationFn: captureMutation('leads', 'update', async ({ id, patch }: { id: string; patch: LeadUpdate }) => {
      await applyLeadPatch([id], patch);
    }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
      void qc.invalidateQueries({ queryKey: queryKeys.lead(vars.id) });
    },
  });
}
