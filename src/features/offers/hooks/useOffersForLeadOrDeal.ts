import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useOffersForLead(leadId: string) {
  return useQuery({
    queryKey: queryKeys.offersForLead(leadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!leadId,
  });
}

export function useOffersForDeal(dealId: string) {
  return useQuery({
    queryKey: queryKeys.offersForDeal(dealId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('deal_id', dealId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!dealId,
  });
}

/** Every offer filed on a client — the accounting/upsell view, where there may
 *  be no lead and no single deal to hang it off. */
export function useOffersForClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.offersForClient(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!clientId,
  });
}
