import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import {
  PageHeader,
  SettingsCard,
  SettingsTableShell,
  settingsTheadClass,
  settingsThClass,
  settingsTrClass,
  settingsTdClass,
} from '@/components/layout/page-shell';
import { useCampaigns, useCampaignStats } from './hooks/useCampaigns';
import { useCreateCampaign } from './hooks/useCampaignMutations';
import { CampaignStatusBadge } from './components/CampaignStatusBadge';
import { rate, formatRate } from './campaignCopy';

/** Per-row stats cells. A separate component so each row's `campaign_stats`
 *  RPC call is independently cached/loading — the list itself only needs
 *  `useCampaigns()`, which doesn't carry recipient/send counts. */
function CampaignStatsCells({ campaignId }: { campaignId: string }) {
  const { data: stats } = useCampaignStats(campaignId);
  const recipientCount = stats
    ? Object.values(stats.by_status).reduce((sum, n) => sum + n, 0)
    : null;
  return (
    <>
      <td className={settingsTdClass}>{recipientCount ?? '—'}</td>
      <td className={settingsTdClass}>{stats ? stats.sent : '—'}</td>
      <td className={settingsTdClass}>{stats ? stats.delivered : '—'}</td>
      <td className={settingsTdClass}>
        {stats ? formatRate(rate(stats.bounced, stats.sent)) : '—'}
      </td>
    </>
  );
}

export function CampaignsListPage() {
  const { t } = useTranslation('email_marketing');
  const navigate = useNavigate();
  const { data: campaigns = [], isLoading, error } = useCampaigns();
  const createCampaign = useCreateCampaign();
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate() {
    setCreateError(null);
    try {
      const result = await createCampaign.mutateAsync({
        name: t('list.new_campaign_default_name'),
      });
      navigate(`/company/email-marketing/${result.campaign_id}/edit`);
    } catch {
      // Task 1's mutations throw on `ok:false` — never let that fail silently.
      setCreateError(t('errors.create_failed'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <PageHeader title={t('list.title')} description={t('list.description')}>
          <Link
            to="/company/email-marketing/audiences"
            className="text-sm font-medium text-primary hover:underline dark:text-[#7ad4d4]"
          >
            {t('list.audiences_link')}
          </Link>
          <Link
            to="/company/email-marketing/suppressions"
            className="text-sm font-medium text-primary hover:underline dark:text-[#7ad4d4]"
          >
            {t('list.suppressions_link')}
          </Link>
          <Button size="sm" onClick={handleCreate} disabled={createCampaign.isPending}>
            + {t('list.new_campaign')}
          </Button>
        </PageHeader>
        {createError ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{createError}</p>
        ) : null}
      </SettingsCard>

      <SettingsTableShell>
        <table className="w-full text-sm">
          <thead className={settingsTheadClass}>
            <tr>
              <th className={settingsThClass}>{t('list.name')}</th>
              <th className={settingsThClass}>{t('list.status')}</th>
              <th className={settingsThClass}>{t('list.recipients')}</th>
              <th className={settingsThClass}>{t('list.sent')}</th>
              <th className={settingsThClass}>{t('list.delivered')}</th>
              <th className={settingsThClass}>{t('list.bounce_rate')}</th>
              <th className={settingsThClass}>{t('list.created')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={7}>
                  {t('list.loading')}
                </td>
              </tr>
            ) : error ? (
              <tr className={settingsTrClass}>
                <td
                  className={cn(settingsTdClass, 'text-red-600 dark:text-red-400')}
                  colSpan={7}
                >
                  {error.message}
                </td>
              </tr>
            ) : campaigns.length === 0 ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={7}>
                  {t('list.empty')}
                </td>
              </tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} className={settingsTrClass}>
                  <td className={settingsTdClass}>
                    <Link
                      to={`/company/email-marketing/${c.id}`}
                      className="font-medium text-primary hover:underline dark:text-[#7ad4d4]"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className={settingsTdClass}>
                    <CampaignStatusBadge status={c.status} />
                  </td>
                  <CampaignStatsCells campaignId={c.id} />
                  <td className={cn(settingsTdClass, 'whitespace-nowrap text-muted-foreground')}>
                    {formatDate(c.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </SettingsTableShell>
    </div>
  );
}
