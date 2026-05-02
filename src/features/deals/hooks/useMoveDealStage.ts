import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { DealRow } from './useDeals';

export function useMoveDealStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, stageId }: { dealId: string; stageId: string }) => {
      const { error } = await supabase.from('deals').update({ stage_id: stageId }).eq('id', dealId);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ dealId, stageId }) => {
      await qc.cancelQueries({ queryKey: queryKeys.deals() });
      const previous = qc.getQueriesData<DealRow[]>({ queryKey: queryKeys.deals() });
      previous.forEach(([key, value]) => {
        if (!value) return;
        qc.setQueryData<DealRow[]>(
          key,
          value.map((d) => (d.id === dealId ? { ...d, stage_id: stageId } : d)),
        );
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals() });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(vars.dealId) });
    },
  });
}
