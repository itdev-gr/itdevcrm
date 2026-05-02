import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type Vars = {
  id: string;
  body: string;
  parent_type: 'client' | 'deal' | 'job' | 'lead';
  parent_id: string;
};

export function useUpdateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      const { error } = await supabase
        .from('comments')
        .update({ body: vars.body })
        .eq('id', vars.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.comments(vars.parent_type, vars.parent_id) });
    },
  });
}
