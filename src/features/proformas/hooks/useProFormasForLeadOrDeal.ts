import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useProFormasForLead(leadId: string) {
  return useQuery({
    queryKey: queryKeys.proFormasForLead(leadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pro_formas')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!leadId,
  });
}

export function useProFormasForDeal(dealId: string) {
  return useQuery({
    queryKey: queryKeys.proFormasForDeal(dealId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pro_formas')
        .select('*')
        .eq('deal_id', dealId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!dealId,
  });
}
