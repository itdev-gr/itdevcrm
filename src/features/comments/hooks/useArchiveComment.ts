import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

type Vars = {
  id: string;
  parent_type: 'client' | 'deal' | 'job' | 'lead';
  parent_id: string;
};

export function useArchiveComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      const userId = useAuthStore.getState().user?.id ?? null;
      const { error } = await supabase
        .from('comments')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: userId,
        })
        .eq('id', vars.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.comments(vars.parent_type, vars.parent_id) });
    },
  });
}
