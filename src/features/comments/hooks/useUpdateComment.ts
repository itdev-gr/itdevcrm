import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { CommentParentType } from '../commentChannels';

type Vars = {
  id: string;
  body: string;
  parent_type: CommentParentType;
  parent_id: string;
};

export function useUpdateComment() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('comments', 'update', async (vars: Vars) => {
      const { error } = await supabase
        .from('comments')
        .update({ body: vars.body })
        .eq('id', vars.id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.comments(vars.parent_type, vars.parent_id) });
    },
  });
}
