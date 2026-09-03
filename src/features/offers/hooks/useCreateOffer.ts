import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { OfferItem, OfferTotals } from '@/lib/offers/types';
import type { Json } from '@/types/supabase';

type Input = {
  lead_id?: string | null;
  deal_id?: string | null;
  client_id?: string | null;
  currency: string;
  discount_amount: number;
  vat_percent: number;
  validity_days: number;
  notes: string | null;
  items: OfferItem[];
  totals: OfferTotals;
};

export function useCreateOffer() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, Input>({
    mutationFn: captureMutation('offers', 'create', async (input: Input): Promise<string> => {
      // Stamp the creator: the offer-view auto-comment and the follow-up
      // scheduler both read offers.created_by, and until now it was always
      // NULL — so a deal/client offer produced no comment at all.
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        lead_id: input.lead_id ?? null,
        deal_id: input.deal_id ?? null,
        client_id: input.client_id ?? null,
        status: 'draft' as const,
        currency: input.currency,
        discount_amount: input.discount_amount,
        vat_percent: input.vat_percent,
        validity_days: input.validity_days,
        notes: input.notes,
        items: input.items as unknown as Json,
        totals: input.totals as unknown as Json,
        created_by: session?.user.id ?? null,
      };
      const { data, error } = await supabase
        .from('offers')
        .insert(payload)
        .select('id')
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to create offer');
      }
      return data.id;
    }),
    onSuccess: (_id, vars) => {
      void qc.invalidateQueries({ queryKey: ['offers'] });
      if (vars.lead_id)
        void qc.invalidateQueries({ queryKey: queryKeys.offersForLead(vars.lead_id) });
      if (vars.deal_id)
        void qc.invalidateQueries({ queryKey: queryKeys.offersForDeal(vars.deal_id) });
      if (vars.client_id)
        void qc.invalidateQueries({ queryKey: queryKeys.offersForClient(vars.client_id) });
    },
  });
}
