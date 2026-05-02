import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

type Vars = {
  parent_type: 'client' | 'deal' | 'job' | 'lead';
  parent_id: string;
  body: string;
  mentioned_user_ids?: string[];
};

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      const author_id = useAuthStore.getState().user?.id;
      if (!author_id) throw new Error('not_authenticated');
      const { error } = await supabase.from('comments').insert({
        parent_type: vars.parent_type,
        parent_id: vars.parent_id,
        body: vars.body,
        author_id,
        mentioned_user_ids: vars.mentioned_user_ids ?? [],
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.comments(vars.parent_type, vars.parent_id) });
    },
  });
}
