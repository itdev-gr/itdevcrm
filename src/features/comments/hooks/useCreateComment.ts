import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { CommentParentType } from '../commentChannels';

type Vars = {
  parent_type: CommentParentType;
  parent_id: string;
  body: string;
  mentioned_user_ids?: string[];
  reply_to_id?: string | null;
};

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('comments', 'create', async (vars: Vars) => {
      const author_id = useAuthStore.getState().user?.id;
      if (!author_id) throw new Error('not_authenticated');
      const { error } = await supabase.from('comments').insert({
        parent_type: vars.parent_type,
        parent_id: vars.parent_id,
        body: vars.body,
        author_id,
        mentioned_user_ids: vars.mentioned_user_ids ?? [],
        reply_to_id: vars.reply_to_id ?? null,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.comments(vars.parent_type, vars.parent_id) });
    },
  });
}
