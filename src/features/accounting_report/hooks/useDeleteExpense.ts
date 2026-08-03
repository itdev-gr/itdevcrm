import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidateFinancialReports } from '@/lib/financialInvalidations';

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense', id] });
      invalidateFinancialReports(qc);
    },
  });
}
