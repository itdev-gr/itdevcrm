import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useMarkInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, total }: { id: string; total: number }) => {
      const { error } = await supabase
        .from('monthly_invoices')
        .update({
          status: 'paid',
          amount_paid: total,
          paid_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.monthlyInvoices() });
      void qc.invalidateQueries({ queryKey: queryKeys.monthlyInvoice(vars.id) });
    },
  });
}
