import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';

/**
 * Profile photo used in the email signature. Fixed storage key <userId>.png in
 * the public `avatars` bucket (upsert); stored value is the public URL with a
 * ?v= cache-buster so replacing the photo propagates to mail clients.
 */
export function ProfilePhotoUpload({
  userId,
  value,
  onChange,
}: {
  userId: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const { t } = useTranslation('users');
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const defaultLogo = `${window.location.origin}/email-assets/itdev-logo-round.png`;

  async function toSquarePng(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      400,
      400,
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(false);
    setBusy(true);
    try {
      const blob = await toSquarePng(file);
      const key = `${userId}.png`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(key, blob, { upsert: true, contentType: 'image/png' });
      if (upErr) throw new Error(upErr.message);
      const { data } = supabase.storage.from('avatars').getPublicUrl(key);
      onChange(`${data.publicUrl}?v=${Date.now()}`);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onRemove() {
    setError(false);
    setBusy(true);
    try {
      await supabase.storage.from('avatars').remove([`${userId}.png`]);
    } finally {
      onChange(null);
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 flex items-center gap-4">
      <img
        src={value || defaultLogo}
        alt={t('profile.photo_title', { defaultValue: 'Profile photo' })}
        className="h-20 w-20 rounded-full border object-cover"
      />
      <div className="space-y-1">
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy
              ? t('profile.photo_uploading', { defaultValue: 'Uploading…' })
              : t('profile.photo_upload', { defaultValue: 'Upload photo' })}
          </button>
          {value && (
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm text-muted-foreground"
              disabled={busy}
              onClick={onRemove}
            >
              {t('profile.photo_remove', { defaultValue: 'Remove' })}
            </button>
          )}
        </div>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('profile.photo_error', { defaultValue: 'Upload failed — try another image.' })}
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={t('profile.photo_upload', { defaultValue: 'Upload photo' })}
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
