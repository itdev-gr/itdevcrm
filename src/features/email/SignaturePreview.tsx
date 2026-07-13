import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { renderSignatureHtml } from '../../../supabase/functions/_shared/signature.ts';
import type { SignaturePerson } from '../../../supabase/functions/_shared/signature.ts';

// Same fixed layout for everyone — the preview is the renderer the emails use.
// logoUrl: the user's avatar (honored only when https), else the IT DEV logo.
export function SignaturePreview({
  person,
  logoUrl,
}: {
  person: SignaturePerson;
  logoUrl?: string | null;
}) {
  const src =
    logoUrl && logoUrl.startsWith('https://')
      ? logoUrl
      : `${window.location.origin}/email-assets/itdev-logo-round.png`;
  return (
    <iframe
      title="signature-preview"
      sandbox=""
      srcDoc={`<body style="margin:8px;background:#ffffff">${renderSignatureHtml(src, person)}</body>`}
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
        .select('full_name, job_title, phone, email, avatar_url')
        .eq('user_id', userId!)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  if (!q.data) return null;
  return (
    <SignaturePreview
      logoUrl={q.data.avatar_url}
      person={{
        name: q.data.full_name ?? '',
        title: q.data.job_title,
        phone: q.data.phone,
        email: q.data.email,
      }}
    />
  );
}
