import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ServicePackageRow = Database['public']['Tables']['service_packages']['Row'];

export function useServicePackages(opts: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: [
      ...queryKeys.servicePackages(),
      { includeArchived: !!opts.includeArchived },
    ] as const,
    queryFn: async (): Promise<ServicePackageRow[]> => {
      let q = supabase
        .from('service_packages')
        .select('*')
        .order('service_type')
        .order('sort_order');
      if (!opts.includeArchived) q = q.eq('archived', false);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as ServicePackageRow[];
    },
  });
}
