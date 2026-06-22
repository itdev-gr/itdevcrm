import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type AccountingClientRow = {
  id: string;
  code: string | null;
  name: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  country: string | null;
  address: string | null;
  vat_number: string | null;
  status: string | null;
  assigned_owner_id: string | null;
  created_at: string;
  start_date: string | null;
  client_blocks: { unblocked_at: string | null; reason: string }[];
  deals: { id: string; archived: boolean; locked_at: string | null }[];
  jobs: {
    id: string;
    service_type: string;
    billing_type: string;
    amount_net: number | null;
    status: string;
    archived: boolean;
  }[];
};

export function useAccountingClients() {
  return useQuery({
    queryKey: ['accounting-clients'] as const,
    queryFn: async (): Promise<AccountingClientRow[]> => {
      const { data, error } = await supabase
        .from('clients')
        .select(
          `
          id, code, name, contact_first_name, contact_last_name, email, phone, website,
          industry, country, address, vat_number, status, assigned_owner_id, created_at, start_date,
          client_blocks!client_id(unblocked_at, reason),
          deals!client_id(id, archived, locked_at),
          jobs!client_id(id, service_type, billing_type, amount_net, status, archived)
          `,
        )
        .eq('archived', false)
        .order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AccountingClientRow[];
    },
  });
}
