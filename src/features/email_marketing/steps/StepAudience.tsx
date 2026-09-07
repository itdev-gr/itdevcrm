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
import { useCampaignAudiences } from '../hooks/useAudiences';
import { useDetachAudience } from '../hooks/useCampaignMutations';
import { ImportAudienceDialog } from '../components/ImportAudienceDialog';

type Props = { campaignId: string };

export function StepAudience({ campaignId }: Props) {
  const { t } = useTranslation('email_marketing');
  const { data: audiences = [], isLoading, error } = useCampaignAudiences(campaignId);
  const detach = useDetachAudience();
  const [importOpen, setImportOpen] = useState(false);
  const [detachTarget, setDetachTarget] = useState<{ id: string; name: string } | null>(null);
  const [detachError, setDetachError] = useState<string | null>(null);

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
        <Button size="sm" onClick={() => setImportOpen(true)}>
          + {t('builder.audience.import_button')}
        </Button>
      </div>

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
