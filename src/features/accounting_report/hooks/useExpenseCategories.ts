import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ExpenseCategory = {
  id: string;
  key: string;
  name_en: string;
  name_el: string;
  sort_order: number;
};

export function useExpenseCategories() {
  return useQuery({
    queryKey: queryKeys.expenseCategories(),
    queryFn: async (): Promise<ExpenseCategory[]> => {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('id, key, name_en, name_el, sort_order')
        .eq('archived', false)
        .order('sort_order', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ExpenseCategory[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
