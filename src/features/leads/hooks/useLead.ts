import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { LeadRow } from './useLeads';

export function useLead(leadId: string) {
  return useQuery({
    queryKey: queryKeys.lead(leadId),
    queryFn: async (): Promise<LeadRow> => {
      const { data, error } = await supabase
        .from('leads')
        .select('*, stage:pipeline_stages(id, code, board, display_names)')
        .eq('id', leadId)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data as unknown as LeadRow;
    },
    enabled: !!leadId,
  });
}
