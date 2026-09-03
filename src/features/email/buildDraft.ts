import i18n from 'i18next';
import '@/lib/i18n';
import { textToHtml } from '@/features/offers/offerEmailBody';

export type Draft = { subject: string; body: string };

// The locale strings are plain text with blank-line paragraphs, but the body
// lands in RichTextEditor, which assigns it as innerHTML — so raw \n\n
// collapsed into a single run-on line. Render the same way the offer composer
// does: paragraphs in, paragraphs out.
export function buildProFormaDraft(name: string, proFormaUrl: string): Draft {
  const t = i18n.getFixedT(null, 'email');
  return {
    subject: t('proforma.subject'),
    body: textToHtml(t('proforma.body', { name, proFormaUrl })),
  };
}

export function buildWonDraft(name: string): Draft {
  const t = i18n.getFixedT(null, 'email');
  return { subject: t('won.subject'), body: textToHtml(t('won.body', { name })) };
}
