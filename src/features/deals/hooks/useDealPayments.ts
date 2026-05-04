import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

export type DealPaymentRow = Database['public']['Tables']['deal_payments']['Row'];
export type DealPaymentInsert = Database['public']['Tables']['deal_payments']['Insert'];
export type DealPaymentUpdate = Database['public']['Tables']['deal_payments']['Update'];

export function dealPaymentsKey(dealId: string) {
  return ['deal-payments', dealId] as const;
}

export function useDealPayments(dealId: string) {
  return useQuery({
    queryKey: dealPaymentsKey(dealId),
    queryFn: async (): Promise<DealPaymentRow[]> => {
      const { data, error } = await supabase
        .from('deal_payments')
        .select('*')
        .eq('deal_id', dealId)
        .order('service_index', { ascending: true })
        .order('start_date', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as DealPaymentRow[];
    },
    enabled: !!dealId,
  });
}

export function useUpdateDealPayment(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('deal_payments', 'update', async ({ id, patch }: { id: string; patch: DealPaymentUpdate }) => {
      const { error } = await supabase.from('deal_payments').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dealPaymentsKey(dealId) });
      void qc.invalidateQueries({ queryKey: ['accounting-deals'] });
    },
  });
}

export function useAddDealPayment(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('deal_payments', 'create', async (row: Omit<DealPaymentInsert, 'deal_id'>) => {
      const { error } = await supabase.from('deal_payments').insert({ ...row, deal_id: dealId });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dealPaymentsKey(dealId) });
      void qc.invalidateQueries({ queryKey: ['accounting-deals'] });
    },
  });
}

export function useDeleteDealPayment(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('deal_payments', 'delete', async (id: string) => {
      const { error } = await supabase.from('deal_payments').delete().eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dealPaymentsKey(dealId) });
      void qc.invalidateQueries({ queryKey: ['accounting-deals'] });
    },
  });
}
