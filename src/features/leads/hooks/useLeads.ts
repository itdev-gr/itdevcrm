import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type LeadRow = Database['public']['Tables']['leads']['Row'] & {
  stage?: { id: string; code: string; board: string; display_names: unknown } | null;
};

export type LeadsFilter = {
  ownerId?: string;
  stageId?: string;
  source?: 'meta' | 'manual' | 'import';
  includeConverted?: boolean;
};

export function useLeads(filter: LeadsFilter = {}) {
  return useQuery({
    queryKey: queryKeys.leads(filter as Record<string, string | undefined>),
    queryFn: async (): Promise<LeadRow[]> => {
      // PostgREST caps a single response at 1000 rows; the pipeline can hold
      // thousands of leads, so page through with .range() until exhausted.
      const PAGE = 1000;
      const all: LeadRow[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from('leads')
          .select('*, stage:pipeline_stages(id, code, board, display_names)')
          .eq('archived', false)
          .order('updated_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (!filter.includeConverted) q = q.is('converted_at', null);
        if (filter.ownerId) q = q.eq('owner_user_id', filter.ownerId);
        if (filter.stageId) q = q.eq('stage_id', filter.stageId);
        if (filter.source) q = q.eq('source', filter.source);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as unknown as LeadRow[];
        all.push(...batch);
        if (batch.length < PAGE) break;
      }
      return all;
    },
  });
}
