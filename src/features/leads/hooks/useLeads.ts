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
      let q = supabase
        .from('leads')
        .select('*, stage:pipeline_stages(id, code, board, display_names)')
        .eq('archived', false)
        .order('updated_at', { ascending: false });
      if (!filter.includeConverted) q = q.is('converted_at', null);
      if (filter.ownerId) q = q.eq('owner_user_id', filter.ownerId);
      if (filter.stageId) q = q.eq('stage_id', filter.stageId);
      if (filter.source) q = q.eq('source', filter.source);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as LeadRow[];
    },
  });
}
