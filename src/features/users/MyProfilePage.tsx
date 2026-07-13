import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';
import { useGoogleConnection } from '@/features/email/useGoogleConnection';
import { SignaturePreview } from '@/features/email/SignaturePreview';
import { useChangePassword } from '@/features/auth/hooks/useChangePassword';
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
  if (!profile.data) return <div className="p-8 text-red-600 dark:text-red-400">Profile not found.</div>;

  // Mount the form fresh per profile row so initial-state hydration is via
  // useState initializers (no setState-in-effect).
  return <ProfileForm key={profile.data.user_id} profile={profile.data} userId={userId} />;
}

function ProfileForm({ profile: p, userId }: { profile: ProfileRow; userId: string }) {
  const { t, i18n } = useTranslation('users');
  const { t: tEmail } = useTranslation('email');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const qc = useQueryClient();
  const google = useGoogleConnection();
  const googleResult = new URLSearchParams(window.location.search).get('google');

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
  const [offerFollowupDays, setOfferFollowupDays] = useState<number>(
    typeof p.offer_followup_days === 'number' ? p.offer_followup_days : 0,
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
      offer_followup_days: Math.max(0, Math.floor(Number(offerFollowupDays) || 0)),
    }),
    [
      fullName,
      email,
      phone,
      phoneExt,
      jobTitle,
      timezone,
      avatarUrl,
      preferredLocale,
      offerFollowupDays,
    ],
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
        <p className="text-sm text-muted-foreground">{t('profile.subtitle')}</p>
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
        <div className="md:col-span-2">
          <Label htmlFor="ofd">
            {t('profile.offer_followup_days', { defaultValue: 'Offer follow-up (days)' })}
          </Label>
          <Input
            id="ofd"
            type="number"
            min={0}
            step={1}
            value={offerFollowupDays}
            onChange={(e) => setOfferFollowupDays(Number(e.target.value))}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t('profile.offer_followup_days_hint', {
              defaultValue:
                'When you create an offer, the lead moves to Offer Sent and a calendar follow-up is scheduled this many days later. 0 disables it.',
            })}
          </p>
        </div>
      </div>
      <div className="rounded-md border p-4">
        <h2 className="text-sm font-medium">
          {t('profile.signature_title', { defaultValue: 'Email signature' })}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('profile.signature_hint', {
            defaultValue:
              'Added automatically to emails you send through the CRM. It is built from your name, job title, phone and email above — edit those fields to change it. The layout is the same for everyone.',
          })}
        </p>
        <div className="mt-3">
          <SignaturePreview
            person={{
              name: fullName.trim() || email.trim(),
              title: jobTitle.trim() || null,
              phone: phone.trim() || null,
              email: email.trim() || null,
            }}
          />
        </div>
      </div>
      <div className="rounded-md border p-4">
        <h2 className="text-sm font-medium">{tEmail('connect.title')}</h2>
        {googleResult === 'connected' && (
          <p className="mt-1 text-sm text-green-700 dark:text-green-400">{tEmail('connect.success')}</p>
        )}
        {googleResult === 'error' && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{tEmail('connect.error')}</p>
        )}
        {google.connected ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {tEmail('connect.connected_as', { email: google.email })}
            </span>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm"
              onClick={() => google.disconnect()}
            >
              {tEmail('connect.disconnect')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mt-2 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            onClick={() => google.connect()}
          >
            {tEmail('connect.connect')}
          </button>
        )}
      </div>
      <ChangePasswordCard />
      <div className="text-xs text-muted-foreground">{autoSaveLabel(status, lang)}</div>
    </div>
  );
}

function ChangePasswordCard() {
  const { t } = useTranslation('users');
  const change = useChangePassword();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = confirm.length > 0 && pw !== confirm;
  const canSubmit = pw.length >= 8 && pw === confirm && !change.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setDone(false);
    try {
      await change.mutateAsync(pw);
      setPw('');
      setConfirm('');
      setDone(true);
    } catch {
      // surfaced via change.isError below
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">
        {t('profile.change_password_title', { defaultValue: 'Change password' })}
      </h2>
      <div>
        <Label htmlFor="np">{t('profile.new_password', { defaultValue: 'New password' })}</Label>
        <Input
          id="np"
          type="password"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setDone(false);
          }}
        />
        {tooShort && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {t('profile.password_too_short', { defaultValue: 'Use at least 8 characters.' })}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="cp">
          {t('profile.confirm_password', { defaultValue: 'Confirm new password' })}
        </Label>
        <Input
          id="cp"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setDone(false);
          }}
        />
        {mismatch && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {t('profile.password_mismatch', { defaultValue: 'Passwords do not match.' })}
          </p>
        )}
      </div>
      {change.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('profile.password_error', {
            defaultValue: 'Could not update the password — please try again.',
          })}
        </p>
      )}
      {done && (
        <p className="text-sm text-green-700 dark:text-green-400">
          {t('profile.password_updated', { defaultValue: 'Password updated.' })}
        </p>
      )}
      <Button type="submit" disabled={!canSubmit}>
        {change.isPending
          ? t('profile.password_updating', { defaultValue: 'Updating…' })
          : t('profile.change_password_title', { defaultValue: 'Change password' })}
      </Button>
    </form>
  );
}
