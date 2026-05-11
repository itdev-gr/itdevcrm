import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ServiceSubpackageRow = Database['public']['Tables']['service_subpackages']['Row'];

export function useServiceSubpackages(parentId: string) {
  return useQuery({
    queryKey: queryKeys.serviceSubpackages(parentId),
    queryFn: async (): Promise<ServiceSubpackageRow[]> => {
      const { data, error } = await supabase
        .from('service_subpackages')
        .select('*')
        .eq('parent_package_id', parentId)
        .eq('archived', false)
        .order('sort_order');
      if (error) throw new Error(error.message);
      return (data ?? []) as ServiceSubpackageRow[];
    },
    enabled: !!parentId,
  });
}
