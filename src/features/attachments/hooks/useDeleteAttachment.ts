import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type Vars = {
  id: string;
  storage_path: string;
  parent_type: 'client' | 'deal' | 'job';
  parent_id: string;
};

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      await supabase.storage.from('attachments').remove([vars.storage_path]);
      const { error } = await supabase.from('attachments').delete().eq('id', vars.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.attachments(vars.parent_type, vars.parent_id),
      });
    },
  });
}
