import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Vars = {
  id: string;
  storage_path: string;
  parent_type: 'client' | 'deal' | 'job' | 'lead';
  parent_id: string;
};

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('attachments', 'delete', async (vars: Vars) => {
      // Remove the storage object FIRST and surface its error. Storage delete is
      // RLS-gated; if it fails (not permitted) we must NOT delete the row, or the
      // file would be orphaned in the bucket forever.
      const { error: storageErr } = await supabase.storage
        .from('attachments')
        .remove([vars.storage_path]);
      if (storageErr) throw new Error(storageErr.message);
      const { error } = await supabase.from('attachments').delete().eq('id', vars.id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.attachments(vars.parent_type, vars.parent_id),
      });
    },
  });
}
