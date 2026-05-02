import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { MonthlyInvoiceRow } from './useMonthlyInvoices';

export type MonthlyInvoiceItem = {
  id: string;
  invoice_id: string;
  job_id: string | null;
  service_type: string | null;
  amount: number;
  description: string | null;
};

export type MonthlyInvoiceWithItems = MonthlyInvoiceRow & {
  items: MonthlyInvoiceItem[];
};

export function useMonthlyInvoice(invoiceId: string) {
  return useQuery({
    queryKey: queryKeys.monthlyInvoice(invoiceId),
    queryFn: async (): Promise<MonthlyInvoiceWithItems> => {
      const { data: invoice, error: e1 } = await supabase
        .from('monthly_invoices')
        .select('*, client:clients(id, name)')
        .eq('id', invoiceId)
        .single();
      if (e1 || !invoice) throw new Error(e1?.message ?? 'Not found');
      const { data: items, error: e2 } = await supabase
        .from('monthly_invoice_items')
        .select('id, invoice_id, job_id, service_type, amount, description')
        .eq('invoice_id', invoiceId)
        .order('created_at');
      if (e2) throw new Error(e2.message);
      return {
        ...(invoice as unknown as MonthlyInvoiceRow),
        items: (items ?? []) as unknown as MonthlyInvoiceItem[],
      };
    },
    enabled: !!invoiceId,
  });
}
