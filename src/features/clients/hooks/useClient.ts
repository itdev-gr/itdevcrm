import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ClientRow } from './useClients';

export function useClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: async (): Promise<ClientRow> => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data as ClientRow;
    },
    enabled: !!clientId,
  });
}
