import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

export type OfferPdfInfo = { url: string | null; path: string; bytes: number };

/** Generates (or regenerates) the offer PDF server-side and returns its
 *  storage path + size, for attaching to the offer email by ref. */
export function useEnsureOfferPdf() {
  return useMutation({
    mutationFn: captureMutation('offers', 'ensure-pdf', async (offerId: string): Promise<OfferPdfInfo> => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('not authenticated');
      const res = await fetch(`/api/offer-pdf?id=${encodeURIComponent(offerId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`PDF generation failed (${res.status}): ${text}`);
      }
      const body = (await res.json()) as { url: string | null; path?: string; bytes?: number };
      return { url: body.url, path: body.path ?? `offers/${offerId}.pdf`, bytes: body.bytes ?? 0 };
    }),
  });
}
