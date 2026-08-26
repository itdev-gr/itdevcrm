import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

/** End of the local day as ISO — cadence tasks due before this count as "now". */
function endOfTodayIso(): string {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

/** Sidebar badge: MY open cadence tasks that are due today or overdue. */
export function useSalesTasksBadge(): number {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data } = useQuery({
    queryKey: queryKeys.salesTasksBadge(userId ?? 'anon'),
    enabled: !!userId,
    refetchInterval: 120_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('user_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId!)
        .not('cadence_run_id', 'is', null)
        .is('completed_at', null)
        .lt('due_at', endOfTodayIso());
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  return data ?? 0;
}
