import i18n from 'i18next';
import '@/lib/i18n';

export type Draft = { subject: string; body: string };

export function buildProFormaDraft(name: string, proFormaUrl: string): Draft {
  const t = i18n.getFixedT(null, 'email');
  return { subject: t('proforma.subject'), body: t('proforma.body', { name, proFormaUrl }) };
}

export function buildWonDraft(name: string): Draft {
  const t = i18n.getFixedT(null, 'email');
  return { subject: t('won.subject'), body: t('won.body', { name }) };
}
