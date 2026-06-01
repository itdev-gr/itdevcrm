import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type CreateExpenseInput = {
  categoryId: string;
  vendor?: string | null;
  billingType: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  amountNet: number;
  vatRate: number;
  startDate: string;
  endDate?: string | null;
  paymentMethod?: string | null;
  paidByUserId?: string | null;
  notes?: string | null;
  markPaid?: boolean;
};

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => {
      const isPaid = input.markPaid === true;
      const { data, error } = await supabase
        .from('expenses')
        .insert({
          category_id: input.categoryId,
          vendor: input.vendor ?? null,
          billing_type: input.billingType,
          amount_net: input.amountNet,
          vat_rate: input.vatRate,
          start_date: input.startDate,
          end_date: input.endDate ?? null,
          payment_method: input.paymentMethod ?? null,
          notes: input.notes ?? null,
          paid_by: isPaid ? (input.paidByUserId ?? null) : null,
          paid_at: isPaid ? new Date().toISOString() : null,
          status: isPaid ? 'paid' : 'pending',
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      void qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
    },
  });
}
