import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type TechMyClientRow = {
  service_type: string;
  client_id: string;
  client_name: string;
  industry: string | null;
  client_status: string | null;
  email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  last_activity: string;
  active_jobs: number;
  any_blocked: boolean;
};

export function useTechMyClients(serviceType: string) {
  return useQuery({
    queryKey: queryKeys.techMyClients(serviceType),
    queryFn: async (): Promise<TechMyClientRow[]> => {
      const { data, error } = await supabase
        .from('tech_my_clients')
        .select('*')
        .eq('service_type', serviceType)
        .order('last_activity', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as TechMyClientRow[];
    },
    enabled: !!serviceType,
  });
}
