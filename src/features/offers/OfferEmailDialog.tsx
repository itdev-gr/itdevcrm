import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SendEmailDialog } from '@/features/email/SendEmailDialog';
import { useAuthStore } from '@/lib/stores/authStore';
import { useUser } from '@/features/users/hooks/useUser';
import { useLead } from '@/features/leads/hooks/useLead';
import { useOffer } from './hooks/useOffer';
import { useUpdateOfferStatus } from './hooks/useUpdateOfferStatus';
import { PUBLIC_OFFER_BASE } from './publicOfferLink';
import { useEnsureOfferPdf, type OfferPdfInfo } from './hooks/useEnsureOfferPdf';
import { useOfferEmailTemplates } from './hooks/useOfferEmailTemplates';
import { buildOfferEmail, type OfferEmailVars, type OfferTemplate } from './offerEmailBody';

type Props = { offerId: string; open: boolean; onClose: () => void };

// Fallbacks so the composer still opens if the seed rows were deleted.
const FALLBACK_INTRO: OfferTemplate = { key: 'offer_email_intro', subject: 'Η προσφορά μας — {{offer_number}}', body: 'Αγαπητέ/ή {{name}}, θα βρείτε την προσφορά μας εδώ:\n{{offer_url}}' };
// No sign-off here: the Gmail signature is appended automatically at send.
const FALLBACK_OUTRO: OfferTemplate = { key: 'offer_email_outro', subject: '', body: 'Παραμένουμε στη διάθεσή σας για οποιαδήποτε απορία.' };

/** Prefilled offer email: intro (with the public offer link) + CTA outro from
 *  admin-editable email_templates rows, sent from the salesperson's Gmail.
 *  Service descriptions live in the generated PDF, not the email body. */
export function OfferEmailDialog({ offerId, open, onClose }: Props) {
  const { t } = useTranslation('email');
  const { data: offer } = useOffer(open ? offerId : '');
  const { data: lead } = useLead(offer?.lead_id ?? '');
  const templates = useOfferEmailTemplates();
  const uid = useAuthStore((s) => s.user?.id ?? '');
  const { data: me } = useUser(uid);
  const updateStatus = useUpdateOfferStatus(offerId);
  const { mutateAsync: generatePdf, isPending: pdfPending } = useEnsureOfferPdf();

  const [dedupeKey, setDedupeKey] = useState('');
  const [pdfInfo, setPdfInfo] = useState<OfferPdfInfo | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [skipPdf, setSkipPdf] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Fresh key per dialog-open: sendPersonal skips any dedupe_key that ever
    // sent, so a stable key would block legitimate resends of the same offer.
    setDedupeKey(`offer:${offerId}:${crypto.randomUUID()}`);
    setPdfInfo(null);
    setPdfError(null);
    setSkipPdf(false);
    generatePdf(offerId)
      .then(setPdfInfo)
      .catch((e: Error) => setPdfError(e.message));
  }, [open, offerId, generatePdf]);

  const byKey = useMemo(() => {
    const m = new Map<string, OfferTemplate>();
    for (const tpl of templates.data ?? []) m.set(tpl.key, tpl);
    return m;
  }, [templates.data]);

  const vars: OfferEmailVars = useMemo(() => ({
    name: lead?.contact_first_name || lead?.company_name || '',
    code: lead?.code ?? '',
    owner_name: me?.full_name ?? '',
    offer_number: offer?.offer_number ?? '',
    validity_days: offer?.validity_days ?? 14,
    offer_url: offer ? `${PUBLIC_OFFER_BASE}${offer.public_token}` : '',
  }), [lead, me, offer]);

  // UD leads get the Under-Development copy (ΡΟΗ_ΝΕΟΥ_LEAD flow); everyone
  // else keeps the classic intro/outro. Falls back to the classic rows if the
  // ud rows are ever deleted.
  const isUdLead = (lead?.stage?.code ?? '').startsWith('ud_');
  const draft = useMemo(() => {
    if (!offer || !templates.data) return null;
    const intro =
      (isUdLead ? byKey.get('ud_offer_email_intro') : undefined) ??
      byKey.get('offer_email_intro') ??
      FALLBACK_INTRO;
    const outro =
      (isUdLead ? byKey.get('ud_offer_email_outro') : undefined) ??
      byKey.get('offer_email_outro') ??
      FALLBACK_OUTRO;
    return buildOfferEmail({ intro, outro, vars });
  }, [offer, templates.data, byKey, vars, isUdLead]);

  if (!open) return null;

  const waiting =
    !offer ||
    (!!offer.lead_id && !lead) ||
    templates.isLoading ||
    !draft ||
    (!pdfInfo && !skipPdf && !pdfError);

  // PDF failed and the user hasn't chosen yet: offer retry / continue without.
  if (pdfError && !skipPdf) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{t('offer_composer.pdf_failed')}</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{pdfError}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>
              {t('dialog.cancel')}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm"
              onClick={() => setSkipPdf(true)}
            >
              {t('offer_composer.continue_anyway')}
            </button>
            <button
              type="button"
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              disabled={pdfPending}
              onClick={() => {
                setPdfError(null);
                generatePdf(offerId).then(setPdfInfo).catch((e: Error) => setPdfError(e.message));
              }}
            >
              {t('offer_composer.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (waiting) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="rounded-lg bg-card px-6 py-4 shadow-lg">
          <p className="text-sm text-muted-foreground">{t('offer_composer.preparing')}</p>
        </div>
      </div>
    );
  }

  return (
    <SendEmailDialog
      open
      identity="personal"
      to={lead?.email ?? ''}
      subject={draft.subject}
      body={draft.html}
      dedupeKey={dedupeKey}
      onClose={onClose}
      onSent={() => {
        if (offer.status === 'draft') updateStatus.mutate('sent');
      }}
    />
  );
}
