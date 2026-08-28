import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { OfferTemplate } from '../offerEmailBody';

/** The offer-composer template rows: intro, outro, and one offer_svc_<type>
 *  block per service. Admin-editable in /admin/email-automations. */
export function useOfferEmailTemplates() {
  return useQuery({
    queryKey: ['offer-email-templates'],
    staleTime: 60_000,
    queryFn: async (): Promise<OfferTemplate[]> => {
      const { data, error } = await supabase
        .from('email_templates')
        .select('key, subject, body')
        .or(
          'key.like.offer_svc_%,key.in.(offer_email_intro,offer_email_outro,ud_offer_email_intro,ud_offer_email_outro)',
        );
      if (error) throw new Error(error.message);
      return (data ?? []) as OfferTemplate[];
    },
  });
}
