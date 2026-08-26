import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type CadenceStepRow = Database['public']['Tables']['ud_cadence_steps']['Row'];
export type CadenceRunRow = Database['public']['Tables']['ud_cadence_runs']['Row'];
export type CadenceRow = Database['public']['Tables']['ud_cadences']['Row'];

export type CadenceTaskRow = Pick<
  Database['public']['Tables']['user_tasks']['Row'],
  'id' | 'title' | 'due_at' | 'completed_at' | 'cadence_outcome' | 'cadence_step_id'
>;

export type LeadCadence = {
  run: CadenceRunRow;
  cadence: CadenceRow;
  steps: CadenceStepRow[];
  /** Every task the chain created for this run, newest last. */
  tasks: CadenceTaskRow[];
};

/** The lead's most recent cadence run (null when the lead never entered a
 *  chain — e.g. any lead outside the Under Development board). */
export function useLeadCadence(leadId: string) {
  return useQuery<LeadCadence | null>({
    queryKey: queryKeys.leadCadence(leadId),
    enabled: !!leadId,
    queryFn: async () => {
      const { data: run, error } = await supabase
        .from('ud_cadence_runs')
        .select('*, cadence:ud_cadences(*, steps:ud_cadence_steps(*))')
        .eq('lead_id', leadId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!run) return null;
      const { cadence, ...runRow } = run as CadenceRunRow & {
        cadence: CadenceRow & { steps: CadenceStepRow[] };
      };
      const { data: tasks, error: tErr } = await supabase
        .from('user_tasks')
        .select('id, title, due_at, completed_at, cadence_outcome, cadence_step_id')
        .eq('cadence_run_id', runRow.id)
        .order('created_at', { ascending: true });
      if (tErr) throw new Error(tErr.message);
      const steps = [...cadence.steps].sort((a, b) => a.position - b.position);
      return { run: runRow, cadence, steps, tasks: tasks ?? [] };
    },
  });
}

export type CompleteCadenceResult = {
  ok: boolean;
  error?: string;
  result?: 'stopped_reached' | 'advanced' | 'exhausted' | 'no_live_run';
  final_move_stage_id?: string | null;
  final_move_stage_code?: string | null;
};

function invalidateCadenceQueries(qc: QueryClient): void {
  for (const queryKey of [
    ['lead-cadence'],
    ['lead-tasks'],
    ['user-tasks'],
    ['tasks'],
    ['leads'],
    ['comments'],
    ['sales-cadence'],
  ] as const) {
    void qc.invalidateQueries({ queryKey: [...queryKey] });
  }
}

/** Close a cadence task with its outcome («Μίλησα» / «Δεν απάντησε»). */
export function useCompleteCadenceTask() {
  const qc = useQueryClient();
  return useMutation<CompleteCadenceResult, Error, { taskId: string; outcome: 'reached' | 'no_answer' }>({
    mutationFn: async ({ taskId, outcome }) => {
      const { data, error } = await supabase.rpc('ud_complete_cadence_task', {
        p_task_id: taskId,
        p_outcome: outcome,
      });
      if (error) throw new Error(error.message);
      const res = data as CompleteCadenceResult;
      if (!res.ok) throw new Error(res.error ?? 'cadence_complete_failed');
      return res;
    },
    onSuccess: () => invalidateCadenceQueries(qc),
  });
}
