import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidateFinancialReports } from '@/lib/financialInvalidations';

export function useMarkExpensePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, paymentMethod }: { id: string; paymentMethod: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;
      const { data, error } = await supabase
        .from('expenses')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
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
