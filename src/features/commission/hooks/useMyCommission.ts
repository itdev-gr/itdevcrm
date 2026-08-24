import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type MyCommission =
  | { found: false }
  | {
      found: true;
      role: string;
      month: number;
      year: number;
      sales_amount: number;
      packages: number;
      commission: number;
      setup_fees: number;
      total_earnings: number;
      bonuses: number;
    };

/** Current-month earnings for the logged-in salesperson, live from the sales app. */
export function useMyCommission() {
  return useQuery({
    queryKey: queryKeys.myCommission(),
    queryFn: async (): Promise<MyCommission> => {
      const { data, error } = await supabase.functions.invoke('my-commission', { body: {} });
      if (error) throw new Error(error.message);
      return (data ?? { found: false }) as MyCommission;
    },
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}
