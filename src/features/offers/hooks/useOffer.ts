import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useOffer(offerId: string) {
  return useQuery({
    queryKey: queryKeys.offer(offerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select('*, client:clients(name)')
        .eq('id', offerId)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data;
    },
    enabled: !!offerId,
  });
}
