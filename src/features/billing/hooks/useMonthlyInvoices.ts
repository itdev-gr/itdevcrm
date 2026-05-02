import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type MonthlyInvoiceRow = Database['public']['Tables']['monthly_invoices']['Row'] & {
  client?: { id: string; name: string } | null;
};

export type MonthlyInvoicesFilter = {
  status?: 'pending' | 'partial' | 'paid' | 'overdue';
  period?: string;
};

export function useMonthlyInvoices(filter: MonthlyInvoicesFilter = {}) {
  return useQuery({
    queryKey: queryKeys.monthlyInvoices(filter as Record<string, string | undefined>),
    queryFn: async (): Promise<MonthlyInvoiceRow[]> => {
      let q = supabase
        .from('monthly_invoices')
        .select('*, client:clients(id, name)')
        .eq('archived', false)
        .order('due_date', { ascending: false });
      if (filter.status) q = q.eq('status', filter.status);
      if (filter.period) q = q.eq('period', filter.period);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as MonthlyInvoiceRow[];
    },
  });
}
