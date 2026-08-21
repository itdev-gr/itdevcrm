import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ContractRow = Database['public']['Tables']['contracts']['Row'];
export type ContractWithParty = ContractRow & {
  clients: { name: string | null; email: string | null; code: string | null } | null;
  leads: {
    title: string | null;
    company_name: string | null;
    email: string | null;
    code: string | null;
  } | null;
};
/** @deprecated kept for older imports — same shape as ContractWithParty. */
export type ContractWithClient = ContractWithParty;

const PARTY_SELECT = '*, clients(name, email, code), leads(title, company_name, email, code)';

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

export function useContractsForLead(leadId: string) {
  return useQuery({
    queryKey: queryKeys.contractsForLead(leadId),
    enabled: !!leadId,
    queryFn: async (): Promise<ContractRow[]> => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useContracts() {
  return useQuery({
    queryKey: queryKeys.contracts,
    queryFn: async (): Promise<ContractWithParty[]> => {
      const { data, error } = await supabase
        .from('contracts')
        .select(PARTY_SELECT)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ContractWithParty[];
    },
  });
}

export function useContract(contractId: string) {
  return useQuery({
    queryKey: queryKeys.contract(contractId),
    enabled: !!contractId,
    queryFn: async (): Promise<ContractWithParty> => {
      const { data, error } = await supabase
        .from('contracts')
        .select(PARTY_SELECT)
        .eq('id', contractId)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as ContractWithParty;
    },
  });
}
