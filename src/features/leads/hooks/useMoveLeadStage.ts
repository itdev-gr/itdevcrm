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
      // Stage changes drive the UD cadence engine (chains stop/start, tasks
      // superseded/created server-side) — refresh those surfaces too.
      void qc.invalidateQueries({ queryKey: queryKeys.leadCadence(vars.leadId) });
      void qc.invalidateQueries({ queryKey: queryKeys.leadTasks(vars.leadId) });
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['comments'] });
      void qc.invalidateQueries({ queryKey: ['sales-cadence'] });
    },
  });
}
