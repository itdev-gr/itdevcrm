import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type SetExpenseAutopayInput = {
  id: string;
  enabled: boolean;
  paymentMethod?: string | null;
};

export function useSetExpenseAutopay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetExpenseAutopayInput): Promise<number> => {
      const { data, error } = await supabase.rpc('set_expense_autopay', {
        p_expense_id: input.id,
        p_enabled: input.enabled,
        p_payment_method: input.paymentMethod ?? null,
      });
      if (error) throw new Error(error.message);
      return (data as number) ?? 0;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense', vars.id] });
      void qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      void qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
    },
  });
}
