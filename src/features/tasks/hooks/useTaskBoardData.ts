import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { ASSIGNED_TASK_SELECT, type AssignedTaskRow } from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';

/** ISO timestamp `days` before now. Call outside render (lazy state init). */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function useTaskBoardData(params: { meId: string; allTeam: boolean; cutoffIso: string }) {
  const { meId, allTeam, cutoffIso } = params;
  const scope = allTeam ? 'all' : meId;

  const userTasks = useQuery<UserTaskRow[]>({
    queryKey: queryKeys.tasksBoardUser(scope, cutoffIso),
    queryFn: async () => {
      let q = supabase.from('user_tasks').select('*');
      if (!allTeam) q = q.or(`user_id.eq.${meId},created_by.eq.${meId}`);
      // open, or resolved within the window
      q = q.or(`completed_at.is.null,completed_at.gte.${cutoffIso}`);
      const { data, error } = await q.order('due_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as UserTaskRow[];
    },
  });

  const assignedTasks = useQuery<AssignedTaskRow[]>({
    queryKey: queryKeys.tasksBoardAssigned(scope, cutoffIso),
    queryFn: async () => {
      let q = supabase.from('assigned_tasks').select(ASSIGNED_TASK_SELECT);
      if (!allTeam) q = q.or(`assignee_user_id.eq.${meId},created_by_user_id.eq.${meId}`);
      q = q.or(`status.eq.open,and(status.eq.resolved,resolved_at.gte.${cutoffIso})`);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AssignedTaskRow[];
    },
  });

  return {
    userRows: userTasks.data ?? [],
    assignedRows: assignedTasks.data ?? [],
    isLoading: userTasks.isLoading || assignedTasks.isLoading,
  };
}
