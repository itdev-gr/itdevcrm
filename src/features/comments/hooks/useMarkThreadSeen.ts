import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import type { CommentParentType } from '../commentChannels';

/** Threads that can carry an unread dot on the deal page's tab strip. */
const DEAL_THREADS = new Set<CommentParentType>([
  'deal',
  'deal_dev',
  'deal_seo',
  'deal_ads',
  'deal_social',
]);

/** Record that I'm looking at a deal thread. CommentsPanel only mounts for
 *  the visible thread (inactive Radix tabs unmount), so mounted = seen —
 *  this covers the deal tabs, single-tab deals, and job pages sharing a
 *  channel. `newestKey` changes when new comments load, re-marking an open
 *  tab; pass null until the thread query succeeds. Non-deal threads
 *  (client/lead/private job) have no dots and are ignored. */
export function useMarkThreadSeen(
  parentType: CommentParentType,
  parentId: string,
  newestKey: string | null,
) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!myId || !parentId || newestKey === null || !DEAL_THREADS.has(parentType)) return;
    let cancelled = false;
    void supabase
      .from('comment_thread_reads')
      .upsert({
        user_id: myId,
        parent_type: parentType,
        parent_id: parentId,
        last_seen_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error || cancelled) return;
        void qc.invalidateQueries({ queryKey: queryKeys.dealCommentUnread(parentId) });
      });
    return () => {
      cancelled = true;
    };
  }, [parentType, parentId, newestKey, myId, qc]);
}
