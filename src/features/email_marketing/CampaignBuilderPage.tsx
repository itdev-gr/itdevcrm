import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';

/** Placeholder — the real 4-step wizard (content, audience, review, schedule)
 *  is built in Tasks 3-4 of the email-marketing UI plan. This just makes the
 *  `/company/email-marketing/new` and `/:campaignId/edit` routes navigable. */
export function CampaignBuilderPage() {
  const { t } = useTranslation('email_marketing');
  const { campaignId } = useParams();

  return (
    <SettingsCard className="p-5">
      <PageHeader title={campaignId ? t('builder.edit_title') : t('builder.new_title')} />
      <p className="mt-3 text-sm text-muted-foreground">{t('builder.coming_soon')}</p>
    </SettingsCard>
  );
}
