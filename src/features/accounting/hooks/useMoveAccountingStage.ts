import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { AccountingDealRow } from './useAccountingDeals';

export function useMoveAccountingStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, stageId }: { dealId: string; stageId: string }) => {
      const { error } = await supabase
        .from('deals')
        .update({ accounting_stage_id: stageId })
        .eq('id', dealId);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ dealId, stageId }) => {
      await qc.cancelQueries({ queryKey: queryKeys.accountingDeals() });
      const previous = qc.getQueriesData<AccountingDealRow[]>({
        queryKey: queryKeys.accountingDeals(),
      });
      previous.forEach(([key, value]) => {
        if (!value) return;
        qc.setQueryData<AccountingDealRow[]>(
          key,
          value.map((d) => (d.id === dealId ? { ...d, accounting_stage_id: stageId } : d)),
        );
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
    },
  });
}
