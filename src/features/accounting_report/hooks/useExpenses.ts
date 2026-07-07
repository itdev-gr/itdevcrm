import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ExpenseFilters = {
  status?: 'pending' | 'paid';
  categoryId?: string;
  vendor?: string;
  billingType?: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  from?: string;
  to?: string;
};

export type ExpenseListRow = {
  id: string;
  category_id: string;
  vendor: string | null;
  billing_type: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  amount_net: number;
  vat_rate: number;
  vat_amount: number;
  amount_gross: number;
  start_date: string;
  end_date: string | null;
  status: 'pending' | 'paid';
  payment_method: string | null;
  paid_at: string | null;
  paid_by: string | null;
  notes: string | null;
  receipt_path: string | null;
  parent_expense_id: string | null;
  autopay: boolean;
  created_by: string | null;
  created_at: string;
  category: { key: string; name_en: string; name_el: string } | null;
};

const SELECT = `
  id, category_id, vendor, billing_type,
  amount_net, vat_rate, vat_amount, amount_gross,
  start_date, end_date, status, payment_method, paid_at, paid_by,
  notes, receipt_path, parent_expense_id, autopay, created_by, created_at,
  category:expense_categories ( key, name_en, name_el )
`;

export function useExpenses(filters: ExpenseFilters = {}) {
  const filterKey: Record<string, string | undefined> = {
    status: filters.status,
    categoryId: filters.categoryId,
    vendor: filters.vendor,
    billingType: filters.billingType,
    from: filters.from,
    to: filters.to,
  };
  return useQuery({
    queryKey: queryKeys.expenses(filterKey),
    queryFn: async (): Promise<ExpenseListRow[]> => {
      let q = supabase.from('expenses').select(SELECT);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.categoryId) q = q.eq('category_id', filters.categoryId);
      if (filters.billingType) q = q.eq('billing_type', filters.billingType);
      if (filters.vendor) q = q.ilike('vendor', `%${filters.vendor}%`);
      if (filters.from) q = q.gte('start_date', filters.from);
      if (filters.to) q = q.lte('start_date', filters.to);
      const { data, error } = await q.order('start_date', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ExpenseListRow[];
    },
  });
}
