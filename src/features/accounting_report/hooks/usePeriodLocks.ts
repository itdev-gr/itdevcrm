import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type PeriodLock = {
  period: string; // 'YYYY-MM'
  locked_at: string;
  locked_by: string | null;
};

/** List of locked periods, most recent first. */
export function usePeriodLocks() {
  return useQuery({
    queryKey: queryKeys.accountingPeriodLocks(),
    queryFn: async (): Promise<PeriodLock[]> => {
      const { data, error } = await supabase
        .from('accounting_period_locks')
        .select('period, locked_at, locked_by')
        .order('period', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 60 * 1000,
  });
}

/** Admin-only: freeze a month (`lock_accounting_period` RPC — DB re-checks admin). */
export function useLockPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string): Promise<string> => {
      const { error } = await supabase.rpc('lock_accounting_period', { p_period: period });
      if (error) throw new Error(error.message);
      return period;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingPeriodLocks() });
    },
  });
}

/** Admin-only: unfreeze a month (`unlock_accounting_period` RPC — DB re-checks admin). */
export function useUnlockPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string): Promise<string> => {
      const { error } = await supabase.rpc('unlock_accounting_period', { p_period: period });
      if (error) throw new Error(error.message);
      return period;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingPeriodLocks() });
    },
  });
}
