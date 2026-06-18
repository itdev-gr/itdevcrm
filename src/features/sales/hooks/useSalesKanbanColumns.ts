import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { LeadRow } from '@/features/leads/hooks/useLeads';
import {
  KANBAN_COLUMN_LIMIT,
  isCollapsedStage,
  orderForSort,
  type SortBy,
} from '../salesKanbanColumns';

export type KanbanStage = { id: string; code: string };

export type KanbanColumn = {
  stageId: string;
  leads: LeadRow[]; // ≤ KANBAN_COLUMN_LIMIT; empty for collapsed stages
  total: number;
};

export type KanbanColumnsFilter = {
  ownerId?: string;
  source?: 'meta' | 'manual' | 'import';
  search?: string;
  sortBy: SortBy;
};

const LEAD_SELECT = '*, stage:pipeline_stages(id, code, board, display_names)';

// Pure: builds the PostgREST `or=` clause for a search term, or null if empty.
// (Kept free of builder types so it can't snag tsc; applied inline below.)
function searchOrClause(search: string): string | null {
  const v = search.replace(/[%,()]/g, ' ').trim();
  if (!v) return null;
  const like = `%${v}%`;
  return [
    `title.ilike.${like}`,
    `company_name.ilike.${like}`,
    `contact_first_name.ilike.${like}`,
    `contact_last_name.ilike.${like}`,
    `email.ilike.${like}`,
    `phone.ilike.${like}`,
  ].join(',');
}

export function useSalesKanbanColumns(stages: KanbanStage[], filter: KanbanColumnsFilter) {
  const keyFilter = {
    owner: filter.ownerId,
    source: filter.source,
    search: filter.search?.trim() || undefined,
    sort: filter.sortBy,
    stages: stages.map((s) => s.id).join(','),
  };

  return useQuery({
    queryKey: queryKeys.salesKanban(keyFilter),
    enabled: stages.length > 0,
    queryFn: async (): Promise<KanbanColumn[]> => {
      const search = filter.search?.trim() ?? '';

      // 1. True totals per stage (RLS-scoped). One round trip.
      // Build args with only defined keys (exactOptionalPropertyTypes forbids
      // passing explicit `undefined` for optional RPC params).
      const countArgs: { p_owner?: string; p_source?: string; p_search?: string } = {};
      if (filter.ownerId) countArgs.p_owner = filter.ownerId;
      if (filter.source) countArgs.p_source = filter.source;
      if (search) countArgs.p_search = search;
      const { data: countRows, error: countErr } = await supabase.rpc(
        'sales_kanban_counts',
        countArgs,
      );
      if (countErr) throw new Error(countErr.message);
      const totals = new Map<string, number>();
      for (const r of (countRows ?? []) as { stage_id: string; total: number }[]) {
        totals.set(r.stage_id, Number(r.total));
      }

      // 2. Capped, ordered cards for ACTIVE stages only (parallel).
      const order = orderForSort(filter.sortBy);
      const orClause = searchOrClause(search);
      const active = stages.filter((s) => !isCollapsedStage(s.code));
      const fetched = await Promise.all(
        active.map(async (s) => {
          let q = supabase
            .from('leads')
            .select(LEAD_SELECT)
            .eq('archived', false)
            .eq('stage_id', s.id)
            .order(order.column, { ascending: order.ascending })
            .limit(KANBAN_COLUMN_LIMIT);
          if (filter.ownerId) q = q.eq('owner_user_id', filter.ownerId);
          if (filter.source) q = q.eq('source', filter.source);
          if (orClause) q = q.or(orClause);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          return [s.id, (data ?? []) as unknown as LeadRow[]] as const;
        }),
      );
      const leadsByStage = new Map<string, LeadRow[]>(fetched);

      return stages.map((s) => ({
        stageId: s.id,
        leads: leadsByStage.get(s.id) ?? [],
        total: totals.get(s.id) ?? 0,
      }));
    },
  });
}
