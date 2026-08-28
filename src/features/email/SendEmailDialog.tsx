import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSendEmail, type SendEmailVars } from './useSendEmail';
import { useDeptCc } from './useDeptCc';
import { RichTextEditor } from './RichTextEditor';
import { useGoogleConnection } from './useGoogleConnection';
import { MySignaturePreview } from './SignaturePreview';
import { useEmailAttachmentStaging, type EmailAttachmentRef } from './hooks/useEmailAttachmentStaging';
import { CommentAttachButton } from '../comments/CommentAttachButton';
import { useFileDropPaste } from '../comments/hooks/useFileDropPaste';
import { useAuthStore } from '@/lib/stores/authStore';
import { parseRecipientList } from '../../../supabase/functions/_shared/recipients.ts';

/** A lightweight File carrying the staged ref's name + byte size, purely so
 *  CommentAttachButton can render the chip label + size (it never re-reads bytes). */
function refToChip(ref: EmailAttachmentRef): File {
  const f = new File([], ref.filename, { type: ref.mimeType });
  Object.defineProperty(f, 'size', { value: ref.bytes });
  return f;
}

export type SendEmailDialogProps = {
  open: boolean;
  identity: SendEmailVars['identity'];
  to: string;
  subject: string;
  body: string;
  dedupeKey?: string;
  onClose: () => void;
  /** Pre-staged attachments (durable objects, e.g. an offer PDF) shown as
   *  removable chips; never deleted from storage by the dialog. */
  initialAttachments?: EmailAttachmentRef[];
  onSent?: () => void;
  /** Extra controls rendered between the editor and the attach button.
   *  `updateBody` maps the current body HTML to a new one. */
  renderExtras?: (ctx: { updateBody: (fn: (cur: string) => string) => void }) => ReactNode;
};

export function SendEmailDialog({ open, identity, to, subject, body, dedupeKey, onClose, initialAttachments, onSent, renderExtras }: SendEmailDialogProps) {
  const { t } = useTranslation('email');
  const send = useSendEmail();
  const att = useEmailAttachmentStaging(initialAttachments ?? []);
  const dnd = useFileDropPaste((f) => void att.addFiles(f), send.isPending);
  const google = useGoogleConnection();
  const needsConnect = identity === 'personal' && !google.connected && !google.isLoading;
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [toEmail, setToEmail] = useState(to);
  const [ccText, setCcText] = useState('');
  const [ccTouched, setCcTouched] = useState(false);
  const [bccText, setBccText] = useState('');

  // Show the department archive copy IN the Cc field (owner rule: the team
  // must SEE which mailbox gets the copy). The server still Bcc's the
  // department as a fallback if the user removes it, deduped against To/Cc.
  const deptCc = useDeptCc(identity === 'personal');
  useEffect(() => {
    if (identity !== 'personal' || ccTouched || ccText !== '') return;
    const boxes = deptCc.data ?? [];
    if (boxes.length > 0) setCcText(boxes.join(', '));
  }, [identity, ccTouched, ccText, deptCc.data]);
  const [subj, setSubj] = useState(subject);
  const [text, setText] = useState(body);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (!toEmail.trim()) return setError(t('dialog.to_required'));
    const cc = parseRecipientList(ccText);
    const bcc = parseRecipientList(bccText);
    if (cc === null || bcc === null) {
      return setError(t('dialog.invalid_recipients', { defaultValue: 'Invalid Cc/Bcc address (comma-separated, max 10).' }));
    }
    try {
      await send.mutateAsync({ identity, to: toEmail.trim(), subject: subj, body: text, cc, bcc, dedupeKey, attachments: att.refs });
      setDone(true);
      void att.cleanup();
      onSent?.();
    } catch (e) {
      const code = (e as Error).message;
      setError(t(`errors.${code}`, { defaultValue: `${t('dialog.failed')} (${code})` }));
    }
  }

  function handleClose() {
    if (!done) void att.cleanup();
    onClose();
  }

  const attError = att.error
    ? (att.error === 'file_too_large' || att.error === 'attachments_too_large'
        ? t(`errors.${att.error}`)
        : att.error)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      {/* Flex column with a viewport cap: the field area scrolls internally so
          the footer (Send) can never be pushed off-screen by a long message. */}
      <div
        {...dnd.dropZoneProps}
        className={`flex max-h-[90vh] w-full max-w-[95vw] flex-col rounded-lg bg-card shadow-lg ${dnd.isDragging ? 'ring-2 ring-primary ring-offset-2' : ''}`}
      >
        <h2 className="px-6 pt-6 pb-4 text-lg font-semibold">{t('dialog.title')}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
        {done ? (
          <p className="text-sm text-green-700 dark:text-green-400">{t('dialog.sent')}</p>
        ) : (
          <>
            <label className="block text-sm">{t('dialog.to')}
              <input aria-label={t('dialog.to')} value={toEmail} onChange={(e) => setToEmail(e.target.value)}
                className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            <label className="mt-3 block text-sm">{t('dialog.cc', { defaultValue: 'Cc' })}
              <input aria-label={t('dialog.cc', { defaultValue: 'Cc' })} value={ccText} onChange={(e) => { setCcText(e.target.value); setCcTouched(true); }}
                placeholder={t('dialog.recipients_hint', { defaultValue: 'email, email — up to 10' })}
                className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            {isAdmin && (
              <label className="mt-3 block text-sm">{t('dialog.bcc', { defaultValue: 'Bcc (admins only)' })}
                <input aria-label={t('dialog.bcc', { defaultValue: 'Bcc (admins only)' })} value={bccText} onChange={(e) => setBccText(e.target.value)}
                  placeholder={t('dialog.recipients_hint', { defaultValue: 'email, email — up to 10' })}
                  className="mt-1 block w-full rounded border px-2 py-1" />
              </label>
            )}
            <label className="mt-3 block text-sm">{t('dialog.subject')}
              <input aria-label={t('dialog.subject')} value={subj} onChange={(e) => setSubj(e.target.value)}
                className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            <div className="mt-3 block text-sm">
              <span>{t('dialog.body')}</span>
              <div className="mt-1" onPaste={dnd.onPaste}>
                <RichTextEditor value={text} onChange={setText} disabled={send.isPending} ariaLabel={t('dialog.body')} />
              </div>
            </div>
            {renderExtras?.({ updateBody: (fn) => setText(fn) })}
            <div className="mt-3">
              <CommentAttachButton
                pending={att.refs.map(refToChip)}
                onPick={(f) => void att.addFiles(f)}
                onRemove={att.remove}
                disabled={send.isPending}
              />
            </div>
            {identity === 'personal' && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">{t('dialog.signature_hint')}</p>
                <p className="text-xs text-muted-foreground">{t('dialog.dept_bcc_hint')}</p>
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
            {attError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{attError}</p>}
            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            {needsConnect && <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{t('connect.needed')}</p>}
          </>
        )}
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-border/60 px-6 py-4">
          <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={handleClose}>{t('dialog.cancel')}</button>
          {!done && (needsConnect ? (
            <button type="button" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={() => google.connect()}>
              {t('connect.connect')}
            </button>
          ) : (
            <button type="button" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              onClick={submit} disabled={send.isPending || att.busy}>{t('dialog.send')}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
