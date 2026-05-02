import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useMarkInvoicePartial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, amountPaid }: { id: string; amountPaid: number }) => {
      const { error } = await supabase
        .from('monthly_invoices')
        .update({
          status: 'partial',
          amount_paid: amountPaid,
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
