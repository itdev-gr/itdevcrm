import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useProForma(proFormaId: string) {
  return useQuery({
    queryKey: queryKeys.proForma(proFormaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pro_formas')
        .select(
          '*, client:clients(name, email), lead:leads(email, contact_first_name, company_name)',
        )
        .eq('id', proFormaId)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data;
    },
    enabled: !!proFormaId,
  });
}
