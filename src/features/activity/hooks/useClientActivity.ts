import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ActivityRow } from './useActivityLog';

const PAGE_SIZE = 50;

/** Every activity_log event for a client, newest first, paginated. */
export function useClientActivity(clientId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.clientActivity(clientId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ActivityRow[]> => {
      const from = (pageParam as number) * PAGE_SIZE;
      const { data, error } = await supabase
        .from('activity_log')
        .select('*, user:profiles!activity_log_user_id_fkey(full_name, email)')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ActivityRow[];
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.length : undefined,
    enabled: !!clientId,
  });
}
