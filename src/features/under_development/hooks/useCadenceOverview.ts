import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import type { CadenceRow, CadenceStepRow } from './useLeadCadence';

export type CadenceLeadLite = {
  id: string;
  title: string;
  code: string | null;
  company_name: string | null;
  phone: string | null;
  stage_id: string | null;
  owner_user_id: string | null;
  archived: boolean;
  converted_at: string | null;
};

const LEAD_EMBED =
  'lead:leads(id, title, code, company_name, phone, stage_id, owner_user_id, archived, converted_at)';

export type CadenceOpenTask = {
  id: string;
  title: string;
  due_at: string;
  user_id: string;
  cadence_run_id: string;
  cadence_step_id: string | null;
  lead: CadenceLeadLite | null;
};

export type CadenceDecision = {
  runId: string;
  reason: 'exhausted' | 'reached';
  lead: CadenceLeadLite;
  /** Suggested terminal stage (exhausted only). */
  finalMoveStageId: string | null;
  finalMoveStageLabel: { en: string; el: string } | null;
};

export type CadenceOverview = {
  openTasks: CadenceOpenTask[];
  /** leadId → ISO of the next scheduled (delayed) email step. */
  pendingEmailByLead: Map<string, string>;
  /** leadId → its open cadence task. */
  taskByLead: Map<string, CadenceOpenTask>;
  needsDecision: CadenceDecision[];
  decisionByLead: Map<string, CadenceDecision>;
  /** cadence_step_id → «x/y» position among the chain's task steps. */
  stepLabelById: Map<string, string>;
};

type LiveRunRow = { id: string; lead_id: string; status: string; next_event_at: string | null };
type EndedRunRow = {
  id: string;
  lead_id: string;
  status: string;
  exhausted_at: string | null;
  started_at: string;
  cadence: { final_move_stage_code: string | null } | null;
  lead: CadenceLeadLite | null;
};

/**
 * Everything the Sales Tasks page and the UD kanban badges need in one place:
 * open chain tasks (with their lead), scheduled email waits, and the leads
 * whose chain ended without a decision (exhausted-not-moved / contact-made).
 * RLS scopes reps to their own leads/tasks automatically; admins see all.
 */
export function useCadenceOverview() {
  const { data: stages = [] } = usePipelineStages();

  const query = useQuery({
    queryKey: queryKeys.salesCadenceOverview(null),
    queryFn: async () => {
      const [tasksRes, liveRes, endedRes, cadRes] = await Promise.all([
        supabase
          .from('user_tasks')
          .select(`id, title, due_at, user_id, cadence_run_id, cadence_step_id, ${LEAD_EMBED}`)
          .not('cadence_run_id', 'is', null)
          .is('completed_at', null)
          .order('due_at', { ascending: true }),
        supabase
          .from('ud_cadence_runs')
          .select('id, lead_id, status, next_event_at')
          .in('status', ['active', 'paused']),
        supabase
          .from('ud_cadence_runs')
          .select(`id, lead_id, status, exhausted_at, started_at, cadence:ud_cadences(final_move_stage_code), ${LEAD_EMBED}`)
          .in('status', ['completed', 'stopped_reached'])
          .order('started_at', { ascending: false }),
        supabase.from('ud_cadences').select('*, steps:ud_cadence_steps(*)'),
      ]);
      for (const r of [tasksRes, liveRes, endedRes, cadRes]) {
        if (r.error) throw new Error(r.error.message);
      }
      return {
        tasks: (tasksRes.data ?? []) as unknown as CadenceOpenTask[],
        live: (liveRes.data ?? []) as unknown as LiveRunRow[],
        ended: (endedRes.data ?? []) as unknown as EndedRunRow[],
        cadences: (cadRes.data ?? []) as unknown as (CadenceRow & { steps: CadenceStepRow[] })[],
      };
    },
  });

  const empty: CadenceOverview = {
    openTasks: [],
    pendingEmailByLead: new Map(),
    taskByLead: new Map(),
    needsDecision: [],
    decisionByLead: new Map(),
    stepLabelById: new Map(),
  };
  if (!query.data || stages.length === 0) {
    return { ...query, overview: empty };
  }

  const { tasks, live, ended, cadences } = query.data;
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const udStageByCode = new Map(
    stages.filter((s) => s.board === 'under_development').map((s) => [s.code, s]),
  );

  const stepLabelById = new Map<string, string>();
  for (const c of cadences) {
    const taskSteps = c.steps
      .filter((s) => s.kind === 'task' && s.enabled)
      .sort((a, b) => a.position - b.position);
    taskSteps.forEach((s, i) => stepLabelById.set(s.id, `${i + 1}/${taskSteps.length}`));
  }

  const taskByLead = new Map<string, CadenceOpenTask>();
  for (const t of tasks) if (t.lead) taskByLead.set(t.lead.id, t);

  const liveLeadIds = new Set(live.map((r) => r.lead_id));
  const pendingEmailByLead = new Map<string, string>();
  for (const r of live) {
    if (r.status === 'active' && r.next_event_at) pendingEmailByLead.set(r.lead_id, r.next_event_at);
  }

  // Newest ended run per lead, only for leads still parked on a non-terminal
  // UD stage with nothing live and no open task — those need a human decision.
  const needsDecision: CadenceDecision[] = [];
  const seenLead = new Set<string>();
  for (const r of ended) {
    const lead = r.lead;
    if (!lead || seenLead.has(lead.id)) continue;
    seenLead.add(lead.id);
    if (lead.archived || lead.converted_at) continue;
    if (liveLeadIds.has(lead.id) || taskByLead.has(lead.id)) continue;
    const stage = lead.stage_id ? stageById.get(lead.stage_id) : undefined;
    if (!stage || stage.board !== 'under_development' || stage.is_terminal) continue;
    if (r.status === 'completed' && !r.exhausted_at) continue;
    const finalStage = r.cadence?.final_move_stage_code
      ? udStageByCode.get(r.cadence.final_move_stage_code)
      : undefined;
    needsDecision.push({
      runId: r.id,
      reason: r.status === 'stopped_reached' ? 'reached' : 'exhausted',
      lead,
      finalMoveStageId: r.status === 'stopped_reached' ? null : (finalStage?.id ?? null),
      finalMoveStageLabel:
        r.status === 'stopped_reached'
          ? null
          : ((finalStage?.display_names as { en: string; el: string } | undefined) ?? null),
    });
  }

  const overview: CadenceOverview = {
    openTasks: tasks.filter((t) => t.lead && !t.lead.archived && !t.lead.converted_at),
    pendingEmailByLead,
    taskByLead,
    needsDecision,
    decisionByLead: new Map(needsDecision.map((d) => [d.lead.id, d])),
    stepLabelById,
  };
  return { ...query, overview };
}
