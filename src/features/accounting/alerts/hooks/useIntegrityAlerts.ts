import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AlertRow } from '../alertPresenters';

/**
 * All open integrity alerts, computed server-side by the
 * `accounting_integrity_alerts()` RPC (sorted by severity/category).
 */
export function useIntegrityAlerts(): { data: AlertRow[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['integrity-alerts'],
    queryFn: async (): Promise<AlertRow[]> => {
      const { data, error } = await supabase.rpc('accounting_integrity_alerts' as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AlertRow[];
    },
  });
  return { data: query.data ?? [], isLoading: query.isLoading };
}
