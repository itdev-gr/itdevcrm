import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type KanbanCountsFilter = {
  ownerId?: string;
  source?: 'meta' | 'manual' | 'import' | 'franchise';
  search?: string;
};

/** True lead count per sales stage (RLS-scoped via the SECURITY INVOKER RPC). */
export function useSalesKanbanCounts(filter: KanbanCountsFilter) {
  const search = filter.search?.trim() ?? '';
  return useQuery({
    queryKey: queryKeys.salesKanbanCounts({
      owner: filter.ownerId,
      source: filter.source,
      search: search || undefined,
    }),
    queryFn: async (): Promise<Map<string, number>> => {
      const args: { p_owner?: string; p_source?: string; p_search?: string } = {};
      if (filter.ownerId) args.p_owner = filter.ownerId;
      if (filter.source) args.p_source = filter.source;
      if (search) args.p_search = search;
      const { data, error } = await supabase.rpc('sales_kanban_counts', args);
      if (error) throw new Error(error.message);
      const m = new Map<string, number>();
      for (const r of (data ?? []) as { stage_id: string; total: number }[]) {
        m.set(r.stage_id, Number(r.total));
      }
      return m;
    },
  });
}
