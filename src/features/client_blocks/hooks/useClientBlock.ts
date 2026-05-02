import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ClientBlockRow = {
  id: string;
  client_id: string;
  blocked_at: string;
  blocked_by: string | null;
  reason: string;
  unblocked_at: string | null;
};

export function useClientBlock(clientId: string) {
  return useQuery({
    queryKey: queryKeys.clientBlock(clientId),
    queryFn: async (): Promise<ClientBlockRow | null> => {
      const { data, error } = await supabase
        .from('client_blocks')
        .select('*')
        .eq('client_id', clientId)
        .is('unblocked_at', null)
        .order('blocked_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as ClientBlockRow | null) ?? null;
    },
    enabled: !!clientId,
  });
}
