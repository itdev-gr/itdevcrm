import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UnreadCommentNotif } from '@/features/tasks/commentBadge';

/** Unread task_comment notifications for the signed-in user (RLS-scoped).
 *  Deliberately uncapped: the bell query is limited to the latest 20 rows
 *  across all types and would undercount older unread comments. */
export function useUnreadCommentNotifs() {
  return useQuery({
    queryKey: queryKeys.unreadCommentNotifs(),
    queryFn: async (): Promise<UnreadCommentNotif[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, payload')
        .eq('type', 'task_comment')
        .is('read_at', null);
      if (error) throw new Error(error.message);
      return (data ?? []) as UnreadCommentNotif[];
    },
  });
}
