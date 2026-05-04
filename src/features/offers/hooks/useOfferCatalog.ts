import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type CatalogSubpackage = {
  id: string;
  code: string;
  display_names: { en?: string; el?: string };
  description: string | null;
  price: number;
  sort_order: number;
};

export type CatalogPackage = {
  id: string;
  service_type: string;
  code: string;
  display_names: { en?: string; el?: string };
  description: string | null;
  subtitle: string | null;
  default_one_time_amount: number;
  default_monthly_amount: number;
  setup_fee: number;
  sort_order: number;
  subpackages: CatalogSubpackage[];
};

export function useOfferCatalog() {
  return useQuery({
    queryKey: queryKeys.offerCatalog(),
    queryFn: async (): Promise<CatalogPackage[]> => {
      const { data, error } = await supabase
        .from('service_packages')
        .select(
          'id, service_type, code, display_names, description, subtitle, default_one_time_amount, default_monthly_amount, setup_fee, sort_order, subpackages:service_subpackages(id, code, display_names, description, price, sort_order)',
        )
        .eq('archived', false)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CatalogPackage[];
    },
    staleTime: 60_000,
  });
}
