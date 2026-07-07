import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ExpenseListRow } from './useExpenses';

const SELECT = `
  id, category_id, vendor, billing_type,
  amount_net, vat_rate, vat_amount, amount_gross,
  start_date, end_date, status, payment_method, paid_at, paid_by,
  notes, receipt_path, parent_expense_id, autopay, created_by, created_at,
  category:expense_categories ( key, name_en, name_el )
`;

export function useExpenseDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.expense(id) : ['expense', 'null'],
    enabled: !!id,
    queryFn: async (): Promise<ExpenseListRow | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('expenses')
        .select(SELECT)
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as ExpenseListRow;
    },
  });
}
