import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { queryKeys } from '@/lib/queryKeys';

type Vars = { kind: 'user' | 'assigned'; taskId: string; id: string };

/** Soft-delete a task comment (archived=true) — recoverable, mirrors the general
 *  comments model. RLS restricts the UPDATE to the author (or an admin). */
export function useDeleteTaskComment() {
  const qc = useQueryClient();
  return useMutation<void, Error, Vars>({
    mutationFn: async ({ id }) => {
      const userId = useAuthStore.getState().user?.id ?? null;
      const { error } = await supabase
        .from('task_comments')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: userId,
        } as never)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_v, { kind, taskId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.taskComments(kind, taskId) });
    },
  });
}
