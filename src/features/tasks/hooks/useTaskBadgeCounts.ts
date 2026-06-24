import { useAuthStore } from '@/lib/stores/authStore';
import { useOpenUserTasks } from '@/features/home/hooks/useOpenUserTasks';
import { useAssignedTasksOpen } from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';
import { useTasksSeenStore } from '../tasksSeenStore';
import { computeTaskBadges } from '../taskBadge';

// Counts for the sidebar Tasks badges: total open tasks the current user has
// (personal + delegated-to-them) and how many arrived since they last opened
// the Tasks page.
export function useTaskBadgeCounts(): { total: number; newCount: number } {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const seenIso = useTasksSeenStore((s) => (userId ? (s.seenByUser[userId] ?? null) : null));
  const { data: userTasks = [] } = useOpenUserTasks({ assigneeUserId: userId });
  const { data: assignedTasks = [] } = useAssignedTasksOpen({ assigneeUserId: userId });
  if (!userId) return { total: 0, newCount: 0 };
  return computeTaskBadges(userTasks, assignedTasks, seenIso);
}
