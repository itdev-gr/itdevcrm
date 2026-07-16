import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { CHANNEL_THREAD, type ChannelTab } from '../commentChannels';
import { deriveUnread, type LatestComment, type ThreadReadRow } from '../unread';

/** Per-tab "has comments I haven't seen" for the deal Comments tab strip.
 *  One tiny limit-1 query per visible tab (hits the comments_parent index)
 *  plus my read rows (RLS scopes them — no user_id filter needed). Disabled
 *  for single-tab deals: no strip, nowhere to show a dot. */
export function useDealCommentUnread(dealId: string, tabs: ChannelTab[]) {
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const tabsKey = tabs.join(',');

  return useQuery({
    queryKey: queryKeys.dealCommentUnreadFor(dealId, tabsKey),
    queryFn: async (): Promise<Partial<Record<ChannelTab, boolean>>> => {
      const uid = myId;
      if (!uid) return {};
      const [reads, latest] = await Promise.all([
        supabase
          .from('comment_thread_reads')
          .select('parent_type, last_seen_at')
          .eq('parent_id', dealId),
        Promise.all(
          tabs.map((tab) =>
            supabase
              .from('comments')
              .select('author_id, created_at')
              .eq('parent_type', CHANNEL_THREAD[tab])
              .eq('parent_id', dealId)
              .eq('archived', false)
              .neq('author_id', uid)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ),
        ),
      ]);
      if (reads.error) throw new Error(reads.error.message);
      const latestByTab: Partial<Record<ChannelTab, LatestComment | null>> = {};
      tabs.forEach((tab, i) => {
        const res = latest[i];
        if (!res) return;
        if (res.error) throw new Error(res.error.message);
        latestByTab[tab] = (res.data as LatestComment | null) ?? null;
      });
      return deriveUnread(tabs, latestByTab, (reads.data ?? []) as ThreadReadRow[], uid);
    },
    enabled: !!dealId && !!myId && tabs.length > 1,
  });
}
