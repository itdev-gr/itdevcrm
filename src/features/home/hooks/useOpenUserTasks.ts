import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from './useUserTasks';

/** An open user_task row for the widget, carrying the joined client (if any). */
export type OpenUserTaskRow = UserTaskRow & { client?: { id: string; name: string } | null };

/**
 * Open (not-yet-completed) personal/calendar tasks assigned to a user, with no
 * date window — used by the home "Assigned to me" widget so every task assigned
 * to me shows up there, not only the ones inside the calendar's current range.
 *
 * `assigneeUserId === null` returns the whole team's open tasks (admin view),
 * mirroring useAssignedTasksOpen.
 */
export function useOpenUserTasks(params: { assigneeUserId: string | null }) {
  const { assigneeUserId } = params;
  return useQuery<OpenUserTaskRow[]>({
    queryKey: queryKeys.openUserTasks(assigneeUserId),
    queryFn: async () => {
      let q = supabase
        .from('user_tasks')
        .select('*, client:clients(id, name)')
        .is('completed_at', null);
      if (assigneeUserId) q = q.eq('user_id', assigneeUserId);
      const { data, error } = await q.order('due_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as OpenUserTaskRow[];
    },
  });
}
