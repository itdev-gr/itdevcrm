import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { groupClientFlow, type ClientFlowGroups, type ClientFlowRow } from '../utils/clientFlow';

/**
 * Monthly client flow (admin-only): new deals, fully-stopped clients and
 * renewal clients for a range, via client_flow_for_range (20260909120000).
 * The RPC returns one kind-typed row per entity; grouping happens client-side.
 */
export function useClientFlow(range: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.accountingClientFlow(range.from, range.to),
    queryFn: async (): Promise<ClientFlowGroups> => {
      const { data, error } = await supabase.rpc('client_flow_for_range' as never, {
        p_from: range.from,
        p_to: range.to,
      } as never);
      if (error) throw new Error(error.message);
      return groupClientFlow((data ?? []) as unknown as ClientFlowRow[]);
    },
  });
}
