import { useTranslation } from 'react-i18next';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';

/** Placeholder — the real dashboard (funnel tiles, lifecycle controls,
 *  suppression breakdown, recipient drawer) is built in Task 5 of the
 *  email-marketing UI plan. This just makes `/company/email-marketing/:campaignId`
 *  navigable. */
export function CampaignDetailPage() {
  const { t } = useTranslation('email_marketing');

  return (
    <SettingsCard className="p-5">
      <PageHeader title={t('detail.title')} />
      <p className="mt-3 text-sm text-muted-foreground">{t('detail.coming_soon')}</p>
    </SettingsCard>
  );
}
