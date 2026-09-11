import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  SettingsCard,
  SettingsTableShell,
  settingsTdClass,
  settingsThClass,
  settingsTheadClass,
  settingsTrClass,
} from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { useCampaign, CAMPAIGN_EDITABLE_STATUSES } from '../hooks/useCampaigns';
import { useCampaignAudiences } from '../hooks/useAudiences';
import { useDetachAudience } from '../hooks/useCampaignMutations';
import { ImportAudienceDialog } from '../components/ImportAudienceDialog';

type Props = { campaignId: string };

export function StepAudience({ campaignId }: Props) {
  const { t } = useTranslation('email_marketing');
  const { data: campaign } = useCampaign(campaignId);
  const { data: audiences = [], isLoading, error } = useCampaignAudiences(campaignId);
  const detach = useDetachAudience();
  const [importOpen, setImportOpen] = useState(false);
  const [detachTarget, setDetachTarget] = useState<{ id: string; name: string } | null>(null);
  const [detachError, setDetachError] = useState<string | null>(null);

  // Fix-pass, Important-3: campaign_attach_audience/campaign_detach_audience
  // refuse outside draft|ready, same as campaign_update
  // (20260907270000:511-513, :551-553). Without this gate, a `sending`
  // campaign let the owner open the import dialog, upload a 12,000-row
  // spreadsheet (audience_create + every audience_add_members batch
  // succeeding), and only THEN fail on the final attach — leaving a
  // fully-populated orphan audience with no campaign. Blocking the trigger
  // (and the detach action) up front prevents that dead end entirely.
  const isEditable = campaign != null && CAMPAIGN_EDITABLE_STATUSES.has(campaign.status);
  const locked = !isEditable;

  const totalRows = audiences.reduce((sum, a) => sum + a.row_count, 0);

  async function confirmDetach() {
    if (!detachTarget) return;
    try {
      await detach.mutateAsync({ campaignId, audienceId: detachTarget.id });
      setDetachTarget(null);
    } catch {
      // Task 1's mutations throw on ok:false — surface it instead of a
      // silently-stuck confirm dialog.
      setDetachError(t('builder.audience.detach_failed'));
    }
  }

  return (
    <SettingsCard className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('builder.audience.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('builder.audience.total_recipients', { count: totalRows })}
          </p>
        </div>
        <Button size="sm" onClick={() => setImportOpen(true)} disabled={locked}>
          + {t('builder.audience.import_button')}
        </Button>
      </div>

      {campaign != null && locked ? (
        <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
          {t('builder.audience.locked_notice', { status: t(`status.${campaign.status}`) })}{' '}
          {t('builder.audience.locked_why')}
        </p>
      ) : null}

      {detachError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{detachError}</p> : null}

      <div className="mt-4">
        <SettingsTableShell>
          <table className="w-full text-sm">
            <thead className={settingsTheadClass}>
              <tr>
                <th className={settingsThClass}>{t('builder.audience.name')}</th>
                <th className={settingsThClass}>{t('builder.audience.row_count')}</th>
                <th className={settingsThClass}>{t('builder.audience.consent_basis')}</th>
                <th className={settingsThClass} aria-hidden />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr className={settingsTrClass}>
                  <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={4}>
                    {t('builder.audience.loading')}
                  </td>
                </tr>
              ) : error ? (
                <tr className={settingsTrClass}>
                  <td className={cn(settingsTdClass, 'text-red-600 dark:text-red-400')} colSpan={4}>
                    {error.message}
                  </td>
                </tr>
              ) : audiences.length === 0 ? (
                <tr className={settingsTrClass}>
                  <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={4}>
                    {t('builder.audience.empty')}
                  </td>
                </tr>
              ) : (
                audiences.map((a) => (
                  <tr key={a.id} className={settingsTrClass}>
                    <td className={settingsTdClass}>{a.name}</td>
                    <td className={settingsTdClass}>{a.row_count}</td>
                    <td className={settingsTdClass}>
                      {t(`builder.audience.consent_basis_options.${a.consent_basis}`)}
                    </td>
                    <td className={cn(settingsTdClass, 'text-right')}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetachTarget({ id: a.id, name: a.name })}
                        disabled={locked}
                      >
                        {t('builder.audience.detach')}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SettingsTableShell>
      </div>

      <ImportAudienceDialog campaignId={campaignId} open={importOpen} onOpenChange={setImportOpen} />

      <ConfirmDialog
        open={!!detachTarget}
        onOpenChange={(next) => { if (!next) setDetachTarget(null); }}
        title={t('builder.audience.detach_confirm_title', { name: detachTarget?.name ?? '' })}
        confirmLabel={t('builder.audience.detach')}
        pending={detach.isPending}
        onConfirm={confirmDetach}
      />
    </SettingsCard>
  );
}
