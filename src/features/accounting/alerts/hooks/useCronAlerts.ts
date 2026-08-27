import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/fetchAllPages';
import type { CronAlertRow } from '../cronAlertPresenters';

/**
 * All OPEN findings from the 04:00 `reconcile_payment_integrity()` cron
 * (cron.job id 14) — a separate population from the live
 * `accounting_integrity_alerts()` RPC (see useIntegrityAlerts.ts): this one
 * is persisted into `public.data_integrity_alerts` and, unlike the live
 * checks, stays open until explicitly resolved (no dismissal mechanism).
 *
 * RLS (`data_integrity_alerts_admin_read`, 20260701010000) already restricts
 * SELECT to admins, so a non-admin viewer simply gets an empty array here
 * (no error) — the page still gates the section on `isAdmin` for a clean
 * empty state instead of a silently-empty admin-only section.
 *
 * Paged via `fetchAllPages`: 348+ open rows today, past PostgREST's 1000-row
 * cap is only a matter of time.
 */
export function useCronAlerts() {
  return useQuery({
    queryKey: ['cron-integrity-alerts'],
    queryFn: async (): Promise<CronAlertRow[]> => {
      const rows = await fetchAllPages(() =>
        supabase
          .from('data_integrity_alerts')
          .select('*')
          .is('resolved_at', null)
          .order('detected_at', { ascending: false }),
      );
      return rows as CronAlertRow[];
    },
  });
}
