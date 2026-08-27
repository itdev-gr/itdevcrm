import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidateFinancialReports } from '@/lib/financialInvalidations';
import { todayLocalISO } from '@/features/deals/paymentsPaidDate';

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
  /** yyyy-mm-dd; only meaningful when markPaid is true. Defaults to today
   *  (local) when markPaid is true and this is omitted. */
  paidDate?: string;
  autopay?: boolean;
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
          paid_at: isPaid ? `${input.paidDate ?? todayLocalISO()}T00:00:00Z` : null,
          status: isPaid ? 'paid' : 'pending',
          autopay: input.autopay === true,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      invalidateFinancialReports(qc);
    },
  });
}
