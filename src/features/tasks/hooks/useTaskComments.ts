import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type TaskCommentRow = {
  id: string;
  body: string;
  created_at: string;
  author_user_id: string;
  author: { user_id: string; full_name: string | null; email: string } | null;
};

const SELECT = 'id, body, created_at, author_user_id, author:author_user_id ( user_id, full_name, email )';

/** Comments for one task (oldest first) + a realtime subscription that refreshes
 *  the thread when a new comment lands. `kind` selects which FK column to filter. */
export function useTaskComments(kind: 'user' | 'assigned', taskId: string | null) {
  const qc = useQueryClient();
  const col = kind === 'user' ? 'user_task_id' : 'assigned_task_id';

  const query = useQuery<TaskCommentRow[]>({
    enabled: !!taskId,
    queryKey: queryKeys.taskComments(kind, taskId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_comments')
        .select(SELECT)
        .eq(col, taskId!)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as TaskCommentRow[];
    },
  });

  useEffect(() => {
    if (!taskId) return;
    const channel = supabase
      .channel(`task-comments-${kind}-${taskId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_comments', filter: `${col}=eq.${taskId}` },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.taskComments(kind, taskId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, kind, taskId, col]);

  return query;
}
