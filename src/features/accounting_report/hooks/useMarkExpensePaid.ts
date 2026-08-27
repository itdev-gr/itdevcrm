import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidateFinancialReports } from '@/lib/financialInvalidations';

export function useMarkExpensePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      paymentMethod,
      paidDate,
    }: {
      id: string;
      paymentMethod: string;
      /** yyyy-mm-dd; defaults to today (local) when omitted. */
      paidDate?: string;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;
      const date = paidDate ?? new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('expenses')
        .update({
          status: 'paid',
          paid_at: `${date}T00:00:00Z`,
          payment_method: paymentMethod,
          paid_by: userId,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense', vars.id] });
      invalidateFinancialReports(qc);
    },
  });
}
