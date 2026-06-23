import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { planLeadShuffle } from '../leadShuffle';

// `.bind(supabase)` is required: supabase-js's `from()`/`rpc()` read `this.rest`,
// so capturing them bare loses the binding and throws "Cannot read properties of
// undefined (reading 'rest')" before any request is sent.
const from = supabase.from.bind(supabase);
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type ShuffleStageInput = { stageId: string; stageCode: string };

export function useShuffleStageLeads() {
  const qc = useQueryClient();
  return useMutation<number, DefaultError, ShuffleStageInput>({
    mutationFn: captureMutation<ShuffleStageInput, number>(
      'leads',
      'shuffle_stage',
      async ({ stageId, stageCode }) => {
        // 1. Every lead currently in the chosen stage (admin RLS sees all).
        const { data: leadRows, error: leadsErr } = await from('leads')
          .select('id, owner_user_id')
          .eq('stage_id', stageId)
          .eq('archived', false)
          .is('converted_at', null);
        if (leadsErr) throw new Error(leadsErr.message);
        const leads = (leadRows ?? []) as { id: string; owner_user_id: string | null }[];
        if (leads.length === 0) return 0;

        // 2. The sales rotation pool (same pool auto-distribution uses).
        const { data: poolData, error: poolErr } = await rpc('lead_shuffle_pool');
        if (poolErr) throw new Error(poolErr.message);
        const pool = (poolData ?? []) as string[];

        // 3. Balanced, no-self assignment computed client-side (unit tested).
        const assignments = planLeadShuffle(
          leads.map((l) => ({ id: l.id, ownerId: l.owner_user_id })),
          pool,
        ).map((a) => ({ lead_id: a.leadId, owner_user_id: a.newOwnerId }));

        // 4. Apply atomically; the RPC resets each lead to New Lead and re-checks
        //    it is still in the chosen stage (race guard). Returns rows updated.
        const { data, error } = await rpc('apply_lead_shuffle', {
          p_stage_code: stageCode,
          p_assignments: assignments,
        });
        if (error) throw new Error(error.message);
        return (data as number | null) ?? 0;
      },
    ),
    // Resolve only after refetch so the caller's success alert shows fresh counts.
    // The leads/kanban-counts/kanban-column query keys all start with 'leads',
    // so invalidating ['leads'] refreshes the whole board.
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.leads() }),
  });
}
