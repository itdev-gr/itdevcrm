import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ContractRow = Database['public']['Tables']['contracts']['Row'];
export type ContractWithClient = ContractRow & {
  clients: { name: string | null; email: string | null; code: string | null } | null;
};

export function useContractsForClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.contractsForClient(clientId),
    enabled: !!clientId,
    queryFn: async (): Promise<ContractRow[]> => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useContracts() {
  return useQuery({
    queryKey: queryKeys.contracts,
    queryFn: async (): Promise<ContractWithClient[]> => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, clients(name, email, code)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ContractWithClient[];
    },
  });
}

export function useContract(contractId: string) {
  return useQuery({
    queryKey: queryKeys.contract(contractId),
    enabled: !!contractId,
    queryFn: async (): Promise<ContractWithClient> => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, clients(name, email, code)')
        .eq('id', contractId)
        .single();
      if (error) throw new Error(error.message);
      return data as ContractWithClient;
    },
  });
}
