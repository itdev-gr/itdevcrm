import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { ASSIGNED_TASK_SELECT, type AssignedTaskRow } from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';
import { useUnreadCommentNotifs } from '@/features/notifications/hooks/useUnreadCommentNotifs';
import { splitTaskIdsByKind, unreadCommentIndex } from '@/features/tasks/commentBadge';

/** ISO timestamp `days` before now. Call outside render (lazy state init). */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export type BoardUserTaskRow = UserTaskRow & {
  lead?: { id: string; title: string; code: string | null } | null;
  client?: { id: string; name: string } | null;
};

export function useTaskBoardData(params: { meId: string; allTeam: boolean; cutoffIso: string }) {
  const { meId, allTeam, cutoffIso } = params;
  const scope = allTeam ? 'all' : meId;

  // Resolved tasks (any age) with an unread reply for me must also load, so
  // columnOf can re-surface them into Replies — the 30-day window misses old
  // ones. Derive the id set from the same unread task_comment notifications the
  // badge uses (keys `<kind>:<task_id>`) and split it per table. Sorted+joined
  // so it feeds both the PostgREST `id.in.(...)` clause and the query key
  // (which must include it so a new reply refetches the board live).
  const { data: unreadNotifs = [] } = useUnreadCommentNotifs();
  const { userIdList, assignedIdList } = useMemo(() => {
    const { userIds, assignedIds } = splitTaskIdsByKind(
      Array.from(unreadCommentIndex(unreadNotifs).keys()),
    );
    return {
      userIdList: userIds.slice().sort().join(','),
      assignedIdList: assignedIds.slice().sort().join(','),
    };
  }, [unreadNotifs]);

  const userTasks = useQuery<BoardUserTaskRow[]>({
    queryKey: [...queryKeys.tasksBoardUser(scope, cutoffIso), userIdList],
    queryFn: async () => {
      let q = supabase
        .from('user_tasks')
        .select('*, lead:leads(id, title, code), client:clients(id, name)')
        // Cadence (Under Development chain) tasks live on the dedicated Sales
        // Tasks page — they never mix into the general board.
        .is('cadence_run_id', null);
      if (!allTeam) q = q.or(`user_id.eq.${meId},created_by.eq.${meId}`);
      // open, or resolved within the window, or any-age with an unread reply.
      // Only emit id.in.(...) when non-empty — PostgREST rejects an empty list.
      const orParts = ['completed_at.is.null', `completed_at.gte.${cutoffIso}`];
      if (userIdList) orParts.push(`id.in.(${userIdList})`);
      q = q.or(orParts.join(','));
      const { data, error } = await q.order('due_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as BoardUserTaskRow[];
    },
  });

  const assignedTasks = useQuery<AssignedTaskRow[]>({
    queryKey: [...queryKeys.tasksBoardAssigned(scope, cutoffIso), assignedIdList],
    queryFn: async () => {
      let q = supabase.from('assigned_tasks').select(ASSIGNED_TASK_SELECT);
      if (!allTeam) q = q.or(`assignee_user_id.eq.${meId},created_by_user_id.eq.${meId}`);
      const orParts = ['status.eq.open', `and(status.eq.resolved,resolved_at.gte.${cutoffIso})`];
      if (assignedIdList) orParts.push(`id.in.(${assignedIdList})`);
      q = q.or(orParts.join(','));
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
