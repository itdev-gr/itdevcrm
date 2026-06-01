import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

type ExpenseUpdate = Database['public']['Tables']['expenses']['Update'];

export type UpdateExpensePatch = {
  vendor?: string | null;
  categoryId?: string;
  billingType?: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  amountNet?: number;
  vatRate?: number;
  startDate?: string;
  endDate?: string | null;
  notes?: string | null;
  paymentMethod?: string | null;
  receiptPath?: string | null;
};

function toDbPatch(p: UpdateExpensePatch): ExpenseUpdate {
  const out: ExpenseUpdate = {};
  if (p.vendor !== undefined) out.vendor = p.vendor;
  if (p.categoryId !== undefined) out.category_id = p.categoryId;
  if (p.billingType !== undefined) out.billing_type = p.billingType;
  if (p.amountNet !== undefined) out.amount_net = p.amountNet;
  if (p.vatRate !== undefined) out.vat_rate = p.vatRate;
  if (p.startDate !== undefined) out.start_date = p.startDate;
  if (p.endDate !== undefined) out.end_date = p.endDate;
  if (p.notes !== undefined) out.notes = p.notes;
  if (p.paymentMethod !== undefined) out.payment_method = p.paymentMethod;
  if (p.receiptPath !== undefined) out.receipt_path = p.receiptPath;
  return out;
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateExpensePatch }) => {
      const { data, error } = await supabase
        .from('expenses')
        .update(toDbPatch(patch))
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense', vars.id] });
      void qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      void qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
    },
  });
}
