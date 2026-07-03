import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDownloadProFormaPdf() {
  return useMutation({
    mutationFn: captureMutation('pro_formas', 'pdf', async (proFormaId: string): Promise<string> => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('not authenticated');
      const res = await fetch(`/api/proforma-pdf?id=${encodeURIComponent(proFormaId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`PDF generation failed (${res.status}): ${text}`);
      }
      const { url } = (await res.json()) as { url: string | null };
      if (!url) throw new Error('signed URL was null');
      return url;
    }),
  });
}
