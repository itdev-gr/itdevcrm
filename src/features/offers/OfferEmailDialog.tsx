import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SendEmailDialog } from '@/features/email/SendEmailDialog';
import { useAuthStore } from '@/lib/stores/authStore';
import { useUser } from '@/features/users/hooks/useUser';
import { useLead } from '@/features/leads/hooks/useLead';
import { useClient } from '@/features/clients/hooks/useClient';
import { resolveOfferRecipient } from '../../../api/_recipient.ts';
import { useOffer } from './hooks/useOffer';
import { useUpdateOfferStatus } from './hooks/useUpdateOfferStatus';
import { PUBLIC_OFFER_BASE } from './publicOfferLink';
import { useEnsureOfferPdf } from './hooks/useEnsureOfferPdf';
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
  // An offer can hang off a client or a deal with no lead at all (the
  // accounting flow). Same precedence the PDF header uses: client, then lead.
  const { data: client } = useClient(offer?.client_id ?? '');
  const templates = useOfferEmailTemplates();
  const uid = useAuthStore((s) => s.user?.id ?? '');
  const { data: me } = useUser(uid);
  const updateStatus = useUpdateOfferStatus(offerId);
  const { mutateAsync: generatePdf } = useEnsureOfferPdf();

  const [dedupeKey, setDedupeKey] = useState('');

  useEffect(() => {
    if (!open) return;
    // Fresh key per dialog-open: sendPersonal skips any dedupe_key that ever
    // sent, so a stable key would block legitimate resends of the same offer.
    setDedupeKey(`offer:${offerId}:${crypto.randomUUID()}`);
    // Warm the PDF, but never block the composer on it: the email carries only
    // the public link, and api/offer-view regenerates a missing or stale PDF on
    // the client's first open (isPdfStale). Since the attachment was dropped
    // for the link, a slow or failed render must not stop the send.
    void generatePdf(offerId).catch(() => undefined);
  }, [open, offerId, generatePdf]);

  const byKey = useMemo(() => {
    const m = new Map<string, OfferTemplate>();
    for (const tpl of templates.data ?? []) m.set(tpl.key, tpl);
    return m;
  }, [templates.data]);

  const recipient = useMemo(() => resolveOfferRecipient(
    client
      ? {
          name: client.name,
          email: client.email,
          contact_first_name: client.contact_first_name,
          contact_last_name: client.contact_last_name,
        }
      : null,
    lead
      ? {
          company_name: lead.company_name,
          email: lead.email,
          contact_first_name: lead.contact_first_name,
          contact_last_name: lead.contact_last_name,
        }
      : null,
  ), [client, lead]);

  const vars: OfferEmailVars = useMemo(() => ({
    name: recipient.clientName === 'Client' ? '' : recipient.clientName,
    code: lead?.code ?? client?.code ?? '',
    owner_name: me?.full_name ?? '',
    offer_number: offer?.offer_number ?? '',
    validity_days: offer?.validity_days ?? 14,
    offer_url: offer ? `${PUBLIC_OFFER_BASE}${offer.public_token}` : '',
  }), [recipient, lead, client, me, offer]);

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
    (!!offer.client_id && !client) ||
    templates.isLoading ||
    !draft;

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
      to={recipient.email ?? ''}
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
