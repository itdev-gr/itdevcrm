import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useMoveLeadStage() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { leadId: string; stageId: string }>({
    mutationFn: captureMutation('leads', 'move_stage', async ({ leadId, stageId }: { leadId: string; stageId: string }) => {
      const { error } = await supabase.from('leads').update({ stage_id: stageId }).eq('id', leadId);
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
      void qc.invalidateQueries({ queryKey: queryKeys.lead(vars.leadId) });
    },
  });
}
