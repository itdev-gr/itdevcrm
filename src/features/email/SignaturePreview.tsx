import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { renderSignatureHtml } from '../../../supabase/functions/_shared/signature.ts';
import type { SignaturePerson } from '../../../supabase/functions/_shared/signature.ts';

// Same fixed layout for everyone — the preview is the renderer the emails use.
export function SignaturePreview({ person }: { person: SignaturePerson }) {
  const logoUrl = `${window.location.origin}/email-assets/itdev-logo-round.png`;
  return (
    <iframe
      title="signature-preview"
      sandbox=""
      srcDoc={`<body style="margin:8px;background:#ffffff">${renderSignatureHtml(logoUrl, person)}</body>`}
      className="h-72 w-full rounded border bg-white"
    />
  );
}

/** Self-fetching variant for places without the profile at hand (compose dialog). */
export function MySignaturePreview() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const q = useQuery({
    queryKey: ['my-signature-profile', userId] as const,
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, job_title, phone, email')
        .eq('user_id', userId!)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  if (!q.data) return null;
  return (
    <SignaturePreview
      person={{
        name: q.data.full_name ?? '',
        title: q.data.job_title,
        phone: q.data.phone,
        email: q.data.email,
      }}
    />
  );
}
