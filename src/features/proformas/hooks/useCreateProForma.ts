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
  source_offer_id?: string | null;
  currency: string;
  discount_amount: number;
  vat_percent: number;
  validity_days: number;
  notes: string | null;
  items: OfferItem[];
  totals: OfferTotals;
};

export function useCreateProForma() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, Input>({
    mutationFn: captureMutation('pro_formas', 'create', async (input: Input): Promise<string> => {
      // Stamp the creator so per-user behavior has a real value to key off
      // (offers do the same since the accounting-access rollout).
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        lead_id: input.lead_id ?? null,
        deal_id: input.deal_id ?? null,
        client_id: input.client_id ?? null,
        source_offer_id: input.source_offer_id ?? null,
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
        .from('pro_formas')
        .insert(payload)
        .select('id')
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to create pro forma');
      }
      return data.id;
    }),
    onSuccess: (_id, vars) => {
      void qc.invalidateQueries({ queryKey: ['pro-formas'] });
      if (vars.lead_id)
        void qc.invalidateQueries({ queryKey: queryKeys.proFormasForLead(vars.lead_id) });
      if (vars.deal_id)
        void qc.invalidateQueries({ queryKey: queryKeys.proFormasForDeal(vars.deal_id) });
    },
  });
}
