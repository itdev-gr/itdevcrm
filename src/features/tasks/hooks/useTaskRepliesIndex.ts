import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUnreadCommentNotifs } from '@/features/notifications/hooks/useUnreadCommentNotifs';
import { chunkIds, foreignCommentKeys, replyCandidateIds, type TaskCommentIdRow } from '../repliesIndex';
import type { TaskCard } from '../taskCard';

const PAGE = 1000; // PostgREST silently caps at 1000 rows — page explicitly.

async function fetchForeignCommentRows(
  column: 'user_task_id' | 'assigned_task_id',
  ids: string[],
  meId: string,
): Promise<TaskCommentIdRow[]> {
  const rows: TaskCommentIdRow[] = [];
  for (const chunk of chunkIds(ids)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('task_comments')
        .select('user_task_id, assigned_task_id')
        .in(column, chunk)
        .neq('author_user_id', meId)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as TaskCommentIdRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
  }
  return rows;
}

/** Card keys (`user:<id>` / `assigned:<id>`) of the viewer's open party tasks
 *  that have at least one comment from someone else — the persistent Replies
 *  set. RLS already scopes task_comments to parties, matching the rule. */
export function useTaskRepliesIndex(cards: TaskCard[], meId: string): Set<string> {
  const { userIds, assignedIds } = useMemo(() => replyCandidateIds(cards), [cards]);
  // Every foreign comment on my task also creates a task_comment notification
  // for me, and the bell's realtime invalidation refreshes that query — salt
  // the key with the unread ids so a brand-new reply refetches this index live.
  const { data: unreadNotifs = [] } = useUnreadCommentNotifs();
  const notifSalt = useMemo(
    () => unreadNotifs.map((n) => n.id).sort().join(','),
    [unreadNotifs],
  );
  const query = useQuery({
    queryKey: ['task-replies', meId, userIds.join(','), assignedIds.join(','), notifSalt],
    enabled: !!meId && (userIds.length > 0 || assignedIds.length > 0),
    // Key changes (new/cleared notifs) must not blank the Replies column while
    // the refetch is in flight — keep showing the previous key's data.
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const [userRows, assignedRows] = await Promise.all([
        userIds.length ? fetchForeignCommentRows('user_task_id', userIds, meId) : Promise.resolve([]),
        assignedIds.length ? fetchForeignCommentRows('assigned_task_id', assignedIds, meId) : Promise.resolve([]),
      ]);
      return Array.from(foreignCommentKeys([...userRows, ...assignedRows]));
    },
  });
  return useMemo(() => new Set(query.data ?? []), [query.data]);
}
