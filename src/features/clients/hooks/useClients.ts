import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ClientRow = Database['public']['Tables']['clients']['Row'];

export function useClients() {
  return useQuery({
    queryKey: queryKeys.clients(),
    queryFn: async (): Promise<ClientRow[]> => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ClientRow[];
    },
  });
}
