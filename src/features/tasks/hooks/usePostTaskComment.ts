import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type Vars = { kind: 'user' | 'assigned'; taskId: string; body: string };

export function usePostTaskComment() {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, Vars>({
    mutationFn: async ({ kind, taskId, body }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const row =
        kind === 'user'
          ? { user_task_id: taskId, assigned_task_id: null, author_user_id: user.id, body }
          : { user_task_id: null, assigned_task_id: taskId, author_user_id: user.id, body };
      const { data, error } = await supabase
        .from('task_comments')
        .insert(row as never)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { id: (data as { id: string }).id };
    },
    onSuccess: (_v, { kind, taskId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.taskComments(kind, taskId) });
    },
  });
}
