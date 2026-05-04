import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Sentry } from '@/lib/sentry';

export function useDownloadOfferPdf() {
  return useMutation({
    mutationFn: async (offerId: string): Promise<string> => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('not authenticated');
      const res = await fetch(`/api/offer-pdf?id=${encodeURIComponent(offerId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`PDF generation failed (${res.status}): ${text}`);
        Sentry.captureException(err, { tags: { feature: 'offers', op: 'pdf' } });
        throw err;
      }
      const { url } = (await res.json()) as { url: string | null };
      if (!url) throw new Error('signed URL was null');
      return url;
    },
  });
}
