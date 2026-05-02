import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type DealRow = Database['public']['Tables']['deals']['Row'] & {
  client?: { id: string; name: string } | null;
  stage?: { id: string; code: string; board: string; display_names?: unknown } | null;
  accounting_stage?: { id: string; code: string; board: string; display_names?: unknown } | null;
};

export type DealsFilter = {
  ownerId?: string;
  clientId?: string;
};

export function useDeals(filter: DealsFilter = {}) {
  return useQuery({
    queryKey: queryKeys.deals(filter as Record<string, string | undefined>),
    queryFn: async (): Promise<DealRow[]> => {
      let q = supabase
        .from('deals')
        .select(
          '*, client:clients(id, name), stage:pipeline_stages!deals_stage_id_fkey(id, code, board, display_names), accounting_stage:pipeline_stages!deals_accounting_stage_id_fkey(id, code, board, display_names)',
        )
        .eq('archived', false)
        .order('updated_at', { ascending: false });
      if (filter.ownerId) q = q.eq('owner_user_id', filter.ownerId);
      if (filter.clientId) q = q.eq('client_id', filter.clientId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DealRow[];
    },
  });
}
