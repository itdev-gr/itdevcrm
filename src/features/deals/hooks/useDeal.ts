import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { DealRow } from './useDeals';

export function useDeal(dealId: string) {
  return useQuery({
    queryKey: queryKeys.deal(dealId),
    queryFn: async (): Promise<DealRow> => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          '*, client:clients(id, name), stage:pipeline_stages!deals_stage_id_fkey(id, code, board, display_names), accounting_stage:pipeline_stages!deals_accounting_stage_id_fkey(id, code, board, display_names)',
        )
        .eq('id', dealId)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data as unknown as DealRow;
    },
    enabled: !!dealId,
  });
}
