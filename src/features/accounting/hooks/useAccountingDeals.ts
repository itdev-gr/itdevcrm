import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { DealRow } from '@/features/deals/hooks/useDeals';

export type AccountingDealRow = DealRow & {
  accounting_stage?: { id: string; code: string; board: string } | null;
};

export function useAccountingDeals() {
  return useQuery({
    queryKey: queryKeys.accountingDeals(),
    queryFn: async (): Promise<AccountingDealRow[]> => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          '*, client:clients(id, name), accounting_stage:pipeline_stages!deals_accounting_stage_id_fkey(id, code, board)',
        )
        .not('accounting_stage_id', 'is', null)
        .is('accounting_completed_at', null)
        .eq('archived', false)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AccountingDealRow[];
    },
  });
}
