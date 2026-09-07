import { useTranslation } from 'react-i18next';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';

/** Placeholder — the real list-management page (row counts, consent basis,
 *  source, delete-with-in-use-guard) is built in Task 6 of the email-marketing
 *  UI plan. This just makes `/company/email-marketing/audiences` navigable. */
export function AudiencesPage() {
  const { t } = useTranslation('email_marketing');

  return (
    <SettingsCard className="p-5">
      <PageHeader title={t('audiences.title')} />
      <p className="mt-3 text-sm text-muted-foreground">{t('audiences.coming_soon')}</p>
    </SettingsCard>
  );
}
