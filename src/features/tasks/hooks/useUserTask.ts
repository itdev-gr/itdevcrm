import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import type { TaskLeadJoin } from '@/features/tasks/taskCard';

export type UserTaskDetailRow = UserTaskRow & { lead?: TaskLeadJoin | null };

/** Single user_task by id (lead joined). Returns null when the row doesn't
 *  exist OR the viewer lacks RLS access (assignee/creator/admin only). */
export function useUserTask(taskId: string) {
  return useQuery({
    queryKey: ['user-tasks', 'detail', taskId],
    enabled: !!taskId,
    queryFn: async (): Promise<UserTaskDetailRow | null> => {
      const { data, error } = await supabase
        .from('user_tasks')
        .select('*, lead:leads(id, title, code)')
        .eq('id', taskId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as UserTaskDetailRow | null;
    },
  });
}
