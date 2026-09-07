import { useTranslation } from 'react-i18next';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';

/** Placeholder — the real suppression-list page (search, reason, bounce
 *  counts, unsuppress-with-confirmation) is built in Task 6 of the
 *  email-marketing UI plan. This just makes `/company/email-marketing/suppressions`
 *  navigable. */
export function SuppressionsPage() {
  const { t } = useTranslation('email_marketing');

  return (
    <SettingsCard className="p-5">
      <PageHeader title={t('suppressions.title')} />
      <p className="mt-3 text-sm text-muted-foreground">{t('suppressions.coming_soon')}</p>
    </SettingsCard>
  );
}
