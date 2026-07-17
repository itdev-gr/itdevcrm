import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type Vars = { kind: 'user' | 'assigned'; taskId: string; id: string; body: string };

/** Edit a task comment's body. RLS restricts this to the author (or an admin);
 *  the DB trigger stamps updated_at, which drives the "edited" indicator. */
export function useUpdateTaskComment() {
  const qc = useQueryClient();
  return useMutation<void, Error, Vars>({
    mutationFn: async ({ id, body }) => {
      const { error } = await supabase
        .from('task_comments')
        .update({ body } as never)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_v, { kind, taskId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.taskComments(kind, taskId) });
    },
  });
}
