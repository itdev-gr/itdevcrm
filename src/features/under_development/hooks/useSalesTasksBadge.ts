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

/**
 * Sidebar badge: MY open cadence tasks due today or overdue, plus MY meetings
 * happening today (or already passed while the lead still sits in Scheduled —
 * those need an outcome too).
 */
export function useSalesTasksBadge(): number {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data } = useQuery({
    queryKey: queryKeys.salesTasksBadge(userId ?? 'anon'),
    enabled: !!userId,
    refetchInterval: 120_000,
    queryFn: async (): Promise<number> => {
      const [tasksRes, meetingsRes] = await Promise.all([
        supabase
          .from('user_tasks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId!)
          .not('cadence_run_id', 'is', null)
          .is('completed_at', null)
          .lt('due_at', endOfTodayIso()),
        supabase
          .from('leads')
          .select('id, stage:pipeline_stages!inner(code)', { count: 'exact', head: true })
          .eq('owner_user_id', userId!)
          .eq('archived', false)
          .is('converted_at', null)
          .eq('stage.code', 'ud_scheduled')
          .not('scheduled_for', 'is', null)
          .lt('scheduled_for', endOfTodayIso()),
      ]);
      if (tasksRes.error) throw new Error(tasksRes.error.message);
      if (meetingsRes.error) throw new Error(meetingsRes.error.message);
      return (tasksRes.count ?? 0) + (meetingsRes.count ?? 0);
    },
  });
  return data ?? 0;
}
