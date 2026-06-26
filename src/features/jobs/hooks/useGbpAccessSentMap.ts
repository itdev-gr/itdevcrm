import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type SentRow = { to_email: string; last_sent: string };

/** Map of lowercased client email -> ISO timestamp of the last localseo_gbp_access
 *  email sent to them. One cached fetch shared by every Local SEO card. */
export function useGbpAccessSentMap(enabled: boolean): Record<string, string> {
  const { data } = useQuery({
    queryKey: ['gbp-access-sent-map'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      // RPC not yet in generated types; cast the name + the rows.
      const { data, error } = await supabase.rpc('gbp_access_sent_map' as never);
      if (error) throw new Error(error.message);
      const map: Record<string, string> = {};
      for (const row of (data ?? []) as unknown as SentRow[]) {
        map[row.to_email] = row.last_sent;
      }
      return map;
    },
  });
  return data ?? {};
}
