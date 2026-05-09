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
      const { data, error } = await (
        supabase.from as unknown as (table: string) => {
          select: (cols: string) => {
            eq: (
              c: string,
              v: string,
            ) => {
              order: (
                c: string,
                opts: { ascending: boolean },
              ) => Promise<{ data: TechMyClientRow[] | null; error: { message: string } | null }>;
            };
          };
        }
      )('tech_my_clients')
        .select('*')
        .eq('service_type', serviceType)
        .order('last_activity', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!serviceType,
  });
}
