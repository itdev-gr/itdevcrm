import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type RecentCall = {
  t: string;               // 'HH:MM' Athens
  num: string;             // other party number
  dir: 'in' | 'out' | 'int';
  disp: string;            // 'ANSWERED' | 'NO ANSWER' | ...
  dur: number;             // talk seconds
};

export type MyCallStats = {
  extension: string;
  stat_date: string;
  total: number;
  inbound: number;
  outbound: number;
  internal: number;
  answered: number;
  missed: number;
  missed_inbound: number;
  talk_seconds: number;
  ring_seconds: number;
  unique_numbers: number;
  recent: RecentCall[];
} | null;

/** Today's call stats for the logged-in user (RLS-scoped via phone_extension). */
export function useMyCallStats() {
  return useQuery({
    queryKey: queryKeys.callStatsToday(),
    queryFn: async (): Promise<MyCallStats> => {
      const { data, error } = await supabase.rpc('get_my_call_stats_today');
      if (error) throw new Error(error.message);
      // RPC is `returns setof` → PostgREST yields an array (0 or 1 row).
      // (Generated types model `recent` as `Json`, so narrow via `unknown`.)
      const rows = (data ?? []) as unknown as NonNullable<MyCallStats>[];
      return rows[0] ?? null;
    },
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}
