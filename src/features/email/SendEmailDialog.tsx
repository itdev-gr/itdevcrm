import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSendEmail, type SendEmailVars } from './useSendEmail';
import { useGoogleConnection } from './useGoogleConnection';
import { MySignaturePreview } from './SignaturePreview';

export type SendEmailDialogProps = {
  open: boolean;
  identity: SendEmailVars['identity'];
  to: string;
  subject: string;
  body: string;
  dedupeKey?: string;
  onClose: () => void;
};

export function SendEmailDialog({ open, identity, to, subject, body, dedupeKey, onClose }: SendEmailDialogProps) {
  const { t } = useTranslation('email');
  const send = useSendEmail();
  const google = useGoogleConnection();
  const needsConnect = identity === 'personal' && !google.connected && !google.isLoading;
  const [toEmail, setToEmail] = useState(to);
  const [subj, setSubj] = useState(subject);
  const [text, setText] = useState(body);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (!toEmail.trim()) return setError(t('dialog.to_required'));
    try {
      await send.mutateAsync({ identity, to: toEmail.trim(), subject: subj, body: text, dedupeKey });
      setDone(true);
    } catch {
      setError(t('dialog.failed'));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded bg-card p-6 shadow">
        <h2 className="mb-4 text-lg font-semibold">{t('dialog.title')}</h2>
        {done ? (
          <p className="text-sm text-green-700 dark:text-green-400">{t('dialog.sent')}</p>
        ) : (
          <>
            <label className="block text-sm">{t('dialog.to')}
              <input aria-label={t('dialog.to')} value={toEmail} onChange={(e) => setToEmail(e.target.value)}
                className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            <label className="mt-3 block text-sm">{t('dialog.subject')}
              <input aria-label={t('dialog.subject')} value={subj} onChange={(e) => setSubj(e.target.value)}
                className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            <label className="mt-3 block text-sm">{t('dialog.body')}
              <textarea aria-label={t('dialog.body')} value={text} onChange={(e) => setText(e.target.value)}
                rows={8} className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            {identity === 'personal' && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">{t('dialog.signature_hint')}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground underline">
                    {t('dialog.signature_preview')}
                  </summary>
                  <div className="mt-2">
                    <MySignaturePreview />
                  </div>
                </details>
              </div>
            )}
            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            {needsConnect && <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{t('connect.needed')}</p>}
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>{t('dialog.cancel')}</button>
          {!done && (needsConnect ? (
            <button type="button" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={() => google.connect()}>
              {t('connect.connect')}
            </button>
          ) : (
            <button type="button" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              onClick={submit} disabled={send.isPending}>{t('dialog.send')}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
