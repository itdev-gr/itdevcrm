import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Count of open integrity alerts (for the nav badge): the LIVE
 * `accounting_integrity_alerts_count()` RPC plus open rows in
 * `data_integrity_alerts` (the separate 04:00-cron population surfaced in
 * the Alerts page's "Νυχτερινοί έλεγχοι" section — see useCronAlerts.ts).
 * Cached for a minute.
 *
 * The `data_integrity_alerts` count is a plain RLS-filtered `select` rather
 * than an RPC: `data_integrity_alerts_admin_read` (20260701010000) already
 * restricts SELECT to admins, so a non-admin viewer gets 0 rows back with no
 * error — no extra admin check needed here, and no new RPC to grant.
 */
export function useAlertsCount(): { data: number } {
  const query = useQuery({
    queryKey: ['integrity-alerts-count'],
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const [live, cron] = await Promise.all([
        supabase.rpc('accounting_integrity_alerts_count' as never),
        supabase
          .from('data_integrity_alerts')
          .select('*', { count: 'exact', head: true })
          .is('resolved_at', null),
      ]);
      if (live.error) throw new Error(live.error.message);
      if (cron.error) throw new Error(cron.error.message);
      return Number(live.data ?? 0) + (cron.count ?? 0);
    },
  });
  return { data: query.data ?? 0 };
}
