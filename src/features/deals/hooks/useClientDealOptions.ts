import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type DealOption = { id: string; code: string | null; title: string | null };

/** Lightweight list of a client's deals for a dropdown (id + code + title). */
export function useClientDealOptions(clientId: string | undefined) {
  return useQuery<DealOption[]>({
    queryKey: ['client-deal-options', clientId ?? ''],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select('id, code, title')
        .eq('client_id', clientId!)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as DealOption[];
    },
  });
}
