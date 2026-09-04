import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { useTasksSeenStore } from '../tasksSeenStore';
import { computeTaskBadges } from '../taskBadge';

// Counts for the sidebar Tasks badges: total open tasks the current user has
// (personal + delegated-to-them) and how many arrived since they last opened
// the Tasks page.
//
// The Sidebar renders on EVERY page and this badge is ungated, so these two
// queries run app-wide. They used to be useOpenUserTasks + useAssignedTasksOpen
// — the full row sets, `select('*')` plus joins, unbounded — to render two
// numbers. computeTaskBadges only ever reads created_at, so that is all we
// fetch. The full hooks stay for the pages that show the tasks themselves.
//
// Filters mirror those hooks exactly: open personal tasks excluding cadence
// ones (they belong to the Sales Tasks badge), and open assigned tasks.
const BADGE_STALE_MS = 60_000;

function useOpenUserTaskStamps(userId: string | null) {
  return useQuery<{ created_at: string }[]>({
    queryKey: queryKeys.userTasksBadge(userId),
    enabled: !!userId,
    staleTime: BADGE_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_tasks')
        .select('created_at')
        .is('completed_at', null)
        .is('cadence_run_id', null)
        .eq('user_id', userId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as { created_at: string }[];
    },
  });
}

function useAssignedTaskStamps(userId: string | null) {
  return useQuery<{ created_at: string }[]>({
    queryKey: queryKeys.assignedTasksBadge(userId),
    enabled: !!userId,
    staleTime: BADGE_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assigned_tasks')
        .select('created_at')
        .eq('status', 'open')
        .eq('assignee_user_id', userId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as { created_at: string }[];
    },
  });
}

export function useTaskBadgeCounts(): { total: number; newCount: number } {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const seenIso = useTasksSeenStore((s) => (userId ? (s.seenByUser[userId] ?? null) : null));
  const { data: userTasks = [] } = useOpenUserTaskStamps(userId);
  const { data: assignedTasks = [] } = useAssignedTaskStamps(userId);
  if (!userId) return { total: 0, newCount: 0 };
  return computeTaskBadges(userTasks, assignedTasks, seenIso);
}
