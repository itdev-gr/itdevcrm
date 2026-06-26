import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type SentRow = { template_key: string; to_email: string; last_sent: string };

/** Map keyed by `${template_key}|${lowercased email}` -> ISO timestamp of the last
 *  SEO access-request email sent to that client. One cached fetch shared by every
 *  SEO card; `enabled` only on the SEO boards so other boards never fetch it. */
export function useSeoAccessSentMap(enabled: boolean): Record<string, string> {
  const { data } = useQuery({
    queryKey: ['seo-access-sent-map'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      // RPC not yet in generated types; cast the name + the rows.
      const { data, error } = await supabase.rpc('seo_access_sent_map' as never);
      if (error) throw new Error(error.message);
      const map: Record<string, string> = {};
      for (const row of (data ?? []) as unknown as SentRow[]) {
        map[`${row.template_key}|${row.to_email}`] = row.last_sent;
      }
      return map;
    },
  });
  return data ?? {};
}
