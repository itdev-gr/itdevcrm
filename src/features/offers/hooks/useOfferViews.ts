import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type OfferViewStats = {
  count: number; // non-bot opens
  lastViewedAt: string | null;
};

/** Client-open stats for one offer (fed by the public /o/<token> viewer). */
export function useOfferViews(offerId: string | undefined) {
  return useQuery({
    queryKey: ['offer-views', offerId] as const,
    enabled: !!offerId,
    queryFn: async (): Promise<OfferViewStats> => {
      const { data, error } = await supabase
        .from('offer_views')
        .select('viewed_at')
        .eq('offer_id', offerId as string)
        .eq('suspected_bot', false)
        .order('viewed_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { viewed_at: string }[];
      return { count: rows.length, lastViewedAt: rows[0]?.viewed_at ?? null };
    },
  });
}
