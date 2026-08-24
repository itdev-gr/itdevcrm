import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type MyBreakToday = {
  /** Start of the currently open break, or null when not on break. */
  active_started_at: string | null;
  /** Seconds of CLOSED break sessions today (Athens); live part is client-side. */
  total_seconds: number;
} | null;

/** Today's break state for the logged-in user. */
export function useMyBreakToday() {
  return useQuery({
    queryKey: queryKeys.breakToday(),
    queryFn: async (): Promise<MyBreakToday> => {
      const { data, error } = await supabase.rpc('get_my_break_today');
      if (error) throw new Error(error.message);
      // RPC `returns table` → PostgREST yields an array with exactly one row.
      const rows = (data ?? []) as NonNullable<MyBreakToday>[];
      return rows[0] ?? null;
    },
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}
