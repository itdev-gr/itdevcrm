import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Count of open integrity alerts (for the nav badge). Backed by the
 * `accounting_integrity_alerts_count()` RPC; cached for a minute.
 */
export function useAlertsCount(): { data: number } {
  const query = useQuery({
    queryKey: ['integrity-alerts-count'],
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('accounting_integrity_alerts_count' as never);
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
  });
  return { data: query.data ?? 0 };
}
