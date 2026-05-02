import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';
import type { Database } from '@/types/supabase';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export function MyProfilePage() {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const profile = useQuery({
    queryKey: ['my-profile', userId] as const,
    queryFn: async (): Promise<ProfileRow | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      if (error) throw new Error(error.message);
      return data as ProfileRow;
    },
    enabled: !!userId,
  });

  if (profile.isLoading || !userId) return <div className="p-8">…</div>;
  if (!profile.data) return <div className="p-8 text-red-600">Profile not found.</div>;

  // Mount the form fresh per profile row so initial-state hydration is via
  // useState initializers (no setState-in-effect).
  return <ProfileForm key={profile.data.user_id} profile={profile.data} userId={userId} />;
}

function ProfileForm({ profile: p, userId }: { profile: ProfileRow; userId: string }) {
  const { t, i18n } = useTranslation('users');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const qc = useQueryClient();

  const [fullName, setFullName] = useState(p.full_name ?? '');
  const [email, setEmail] = useState(p.email ?? '');
  const [phone, setPhone] = useState(p.phone ?? '');
  const [phoneExt, setPhoneExt] = useState(p.phone_extension ?? '');
  const [jobTitle, setJobTitle] = useState(p.job_title ?? '');
  const [timezone, setTimezone] = useState(p.timezone ?? '');
  const [avatarUrl, setAvatarUrl] = useState(p.avatar_url ?? '');
  const [preferredLocale, setPreferredLocale] = useState<'en' | 'el'>(
    (p.preferred_locale as 'en' | 'el') ?? 'en',
  );

  const patch = useMemo(
    () => ({
      full_name: fullName.trim(),
      email: email.trim(),
      phone: phone.trim() || null,
      phone_extension: phoneExt.trim() || null,
      job_title: jobTitle.trim() || null,
      timezone: timezone.trim() || null,
      avatar_url: avatarUrl.trim() || null,
      preferred_locale: preferredLocale,
    }),
    [fullName, email, phone, phoneExt, jobTitle, timezone, avatarUrl, preferredLocale],
  );

  const status = useAutoSave(patch, async (next) => {
    const { error } = await supabase.from('profiles').update(next).eq('user_id', userId);
    if (error) throw new Error(error.message);
    void qc.invalidateQueries({ queryKey: ['my-profile', userId] });
    if (next.preferred_locale && next.preferred_locale !== i18n.resolvedLanguage) {
      void i18n.changeLanguage(next.preferred_locale);
    }
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
        <p className="text-sm text-slate-500">{t('profile.subtitle')}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="fn">{t('profile.full_name')}</Label>
          <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="em">{t('profile.email')}</Label>
          <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="jt">{t('profile.job_title')}</Label>
          <Input id="jt" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ph">{t('profile.phone')}</Label>
          <Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ext">{t('profile.phone_extension')}</Label>
          <Input id="ext" value={phoneExt} onChange={(e) => setPhoneExt(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tz">{t('profile.timezone')}</Label>
          <Input
            id="tz"
            placeholder="Europe/Athens"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="loc">{t('profile.preferred_locale')}</Label>
          <select
            id="loc"
            value={preferredLocale}
            onChange={(e) => setPreferredLocale(e.target.value as 'en' | 'el')}
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="en">English</option>
            <option value="el">Ελληνικά</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="av">{t('profile.avatar_url')}</Label>
          <Input
            id="av"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
          />
        </div>
      </div>
      <div className="text-xs text-slate-500">{autoSaveLabel(status, lang)}</div>
    </div>
  );
}
