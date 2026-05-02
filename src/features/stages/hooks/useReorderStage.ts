import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { StageRow } from './usePipelineStages';

export function useReorderStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      stages,
      stageId,
      direction,
    }: {
      stages: StageRow[];
      stageId: string;
      direction: 'up' | 'down';
    }) => {
      const sorted = stages.slice().sort((a, b) => a.position - b.position);
      const i = sorted.findIndex((s) => s.id === stageId);
      if (i < 0) return;
      const j = direction === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= sorted.length) return;
      const a = sorted[i]!;
      const b = sorted[j]!;
      const { error: e1 } = await supabase
        .from('pipeline_stages')
        .update({ position: b.position })
        .eq('id', a.id);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase
        .from('pipeline_stages')
        .update({ position: a.position })
        .eq('id', b.id);
      if (e2) throw new Error(e2.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.pipelineStages() });
    },
  });
}
