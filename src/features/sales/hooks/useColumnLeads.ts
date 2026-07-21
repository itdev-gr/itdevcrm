import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { LeadRow } from '@/features/leads/hooks/useLeads';
import {
  KANBAN_PAGE_SIZE,
  LEAD_SELECT,
  orderForSort,
  searchOrClause,
  type SortBy,
} from '../salesKanbanColumns';

export type ColumnLeadsFilter = {
  ownerId?: string;
  source?: 'meta' | 'manual' | 'import' | 'franchise';
  search?: string;
};

/**
 * One sales-stage column's leads, paginated 50 at a time ("Load more").
 * Server-side ordered + searched; RLS limits non-admins to their own leads.
 */
export function useColumnLeads(stageId: string, filter: ColumnLeadsFilter, sortBy: SortBy) {
  const search = filter.search?.trim() ?? '';
  return useInfiniteQuery({
    queryKey: queryKeys.salesKanbanColumn(stageId, {
      owner: filter.ownerId,
      source: filter.source,
      search: search || undefined,
      sort: sortBy,
    }),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<LeadRow[]> => {
      const order = orderForSort(sortBy);
      const orClause = searchOrClause(search);
      let q = supabase
        .from('leads')
        .select(LEAD_SELECT)
        .eq('archived', false)
        .eq('stage_id', stageId)
        .order(order.column, { ascending: order.ascending })
        .order('id', { ascending: true }) // stable tiebreaker for range() paging
        .range(pageParam, pageParam + KANBAN_PAGE_SIZE - 1);
      if (filter.ownerId) q = q.eq('owner_user_id', filter.ownerId);
      if (filter.source) q = q.eq('source', filter.source);
      if (orClause) q = q.or(orClause);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as LeadRow[];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < KANBAN_PAGE_SIZE ? undefined : allPages.length * KANBAN_PAGE_SIZE,
  });
}
