import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SendEmailDialog } from '@/features/email/SendEmailDialog';
import type { EmailAttachmentRef } from '@/features/email/hooks/useEmailAttachmentStaging';
import { useAuthStore } from '@/lib/stores/authStore';
import { useUser } from '@/features/users/hooks/useUser';
import { useLead } from '@/features/leads/hooks/useLead';
import { categoryLabel, SERVICE_TYPES } from '@/lib/offers/serviceLabels';
import type { OfferItem } from '@/lib/offers/types';
import { useOffer } from './hooks/useOffer';
import { useUpdateOfferStatus } from './hooks/useUpdateOfferStatus';
import { useEnsureOfferPdf, type OfferPdfInfo } from './hooks/useEnsureOfferPdf';
import { useOfferEmailTemplates } from './hooks/useOfferEmailTemplates';
import { buildOfferEmail, buildServiceBlockHtml, type OfferEmailVars, type OfferTemplate } from './offerEmailBody';

type Props = { offerId: string; open: boolean; onClose: () => void };

// Fallbacks so the composer still opens if the seed rows were deleted.
const FALLBACK_INTRO: OfferTemplate = { key: 'offer_email_intro', subject: 'Η προσφορά μας — {{offer_number}}', body: 'Αγαπητέ/ή {{name}}, θα βρείτε συνημμένη την προσφορά μας.' };
const FALLBACK_OUTRO: OfferTemplate = { key: 'offer_email_outro', subject: '', body: 'Με εκτίμηση,\n{{owner_name}}' };

/** Prefilled offer email: intro + one block per offered service + outro from
 *  admin-editable email_templates rows, offer PDF attached, sent from the
 *  salesperson's Gmail. The salesperson edits everything before sending. */
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
  const [extraTypes, setExtraTypes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    // Fresh key per dialog-open: sendPersonal skips any dedupe_key that ever
    // sent, so a stable key would block legitimate resends of the same offer.
    setDedupeKey(`offer:${offerId}:${crypto.randomUUID()}`);
    setPdfInfo(null);
    setPdfError(null);
    setSkipPdf(false);
    setExtraTypes(new Set());
    generatePdf(offerId)
      .then(setPdfInfo)
      .catch((e: Error) => setPdfError(e.message));
  }, [open, offerId, generatePdf]);

  const offerTypes = useMemo(() => {
    const items = (offer?.items as unknown as OfferItem[]) ?? [];
    return [...new Set(items.map((it) => it.category))];
  }, [offer]);

  const byKey = useMemo(() => {
    const m = new Map<string, OfferTemplate>();
    for (const tpl of templates.data ?? []) m.set(tpl.key, tpl);
    return m;
  }, [templates.data]);

  const vars: OfferEmailVars = useMemo(() => ({
    name: lead?.contact_first_name || lead?.company_name || '',
    owner_name: me?.full_name ?? '',
    offer_number: offer?.offer_number ?? '',
    validity_days: offer?.validity_days ?? 14,
  }), [lead, me, offer]);

  const draft = useMemo(() => {
    if (!offer || !templates.data) return null;
    const serviceTpls = offerTypes
      .map((type) => byKey.get(`offer_svc_${type}`))
      .filter((tpl): tpl is OfferTemplate => !!tpl);
    return buildOfferEmail({
      intro: byKey.get('offer_email_intro') ?? FALLBACK_INTRO,
      outro: byKey.get('offer_email_outro') ?? FALLBACK_OUTRO,
      serviceTpls,
      vars,
    });
  }, [offer, templates.data, offerTypes, byKey, vars]);

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
              {t('offer_composer.continue_without_pdf')}
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

  const initialAttachments: EmailAttachmentRef[] = pdfInfo
    ? [{
        bucket: 'offer-pdfs',
        path: pdfInfo.path,
        filename: `${offer.offer_number ?? 'offer'}.pdf`,
        mimeType: 'application/pdf',
        bytes: pdfInfo.bytes,
      }]
    : [];

  const availableTypes = SERVICE_TYPES.filter(
    (type) => byKey.has(`offer_svc_${type}`) && !offerTypes.includes(type) && !extraTypes.has(type),
  );

  return (
    <SendEmailDialog
      open
      identity="personal"
      to={lead?.email ?? ''}
      subject={draft.subject}
      body={draft.html}
      dedupeKey={dedupeKey}
      initialAttachments={initialAttachments}
      onClose={onClose}
      onSent={() => {
        if (offer.status === 'draft') updateStatus.mutate('sent');
      }}
      renderExtras={({ appendHtml }) =>
        availableTypes.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">{t('offer_composer.add_service')}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {availableTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent"
                  onClick={() => {
                    const tpl = byKey.get(`offer_svc_${type}`);
                    if (!tpl) return;
                    appendHtml(buildServiceBlockHtml(tpl, vars));
                    setExtraTypes((prev) => new Set(prev).add(type));
                  }}
                >
                  + {categoryLabel(type)}
                </button>
              ))}
            </div>
          </div>
        ) : null
      }
    />
  );
}
