import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  PageHeader,
  SettingsCard,
  SettingsTableShell,
  settingsTheadClass,
  settingsThClass,
  settingsTrClass,
  settingsTdClass,
} from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import { useAudiences, useDeleteAudience, type AudienceRow } from './hooks/useAudiences';
import { useEmailMarketingSettings } from './hooks/useCampaigns';
import { useUpdateMarketingSettings } from './hooks/useCampaignMutations';

function translateDeleteError(message: string, t: TFunction): string {
  switch (message) {
    case 'permission_denied':
      return t('audiences.delete.error_permission_denied');
    case 'audience_not_found':
      return t('audiences.delete.error_not_found');
    // The interesting case: the RPC's FK guard (`in_use`,
    // 20260907270000:459-480) refuses to delete an audience a campaign still
    // references. That code must never reach the screen verbatim — it needs
    // to read as an instruction (go detach it first), not a mystery string.
    case 'in_use':
      return t('audiences.delete.error_in_use');
    default:
      return t('audiences.delete.error_generic');
  }
}

/**
 * Compact global-controls card — exposes `marketing_settings_update`, which
 * nothing in the app calls yet (task-6-brief.md, "Also" section). Lives on
 * AudiencesPage rather than its own route: it is the section closest in
 * spirit to "lists and infrastructure that govern every campaign," and a
 * second nearly-empty settings page felt like more surface area than a
 * five-field card at the top of an existing one warrants.
 *
 * Reads through Task 4's `useEmailMarketingSettings` (reused, not
 * duplicated, per the brief) and writes through `marketing_settings_update`
 * — never a direct table write, since these tables are SELECT-only under RLS.
 */
function GlobalControlsCard() {
  const { t } = useTranslation('email_marketing');
  const settings = useEmailMarketingSettings();
  const update = useUpdateMarketingSettings();

  const [pauseError, setPauseError] = useState<string | null>(null);

  const [caps, setCaps] = useState({ dailyCap: '', hourlyCap: '', batchSlice: '' });
  const [capsSaveState, setCapsSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [capsError, setCapsError] = useState<string | null>(null);

  // Hydrate the cap fields once from the live row — same "hydrate once, never
  // clobber a mid-edit field on a background refetch" pattern as
  // StepSchedule/StepContent.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!settings.data || hydrated.current) return;
    hydrated.current = true;
    setCaps({
      dailyCap: String(settings.data.daily_cap),
      hourlyCap: String(settings.data.hourly_cap),
      batchSlice: String(settings.data.batch_slice),
    });
  }, [settings.data]);

  const paused = settings.data?.paused ?? false;

  // The kill switch is the emergency stop for the entire sending system —
  // it fires immediately on click, with no separate "Save" step, unlike the
  // cap fields below.
  async function handlePauseToggle(next: boolean) {
    setPauseError(null);
    try {
      await update.mutateAsync({ paused: next });
    } catch {
      setPauseError(t('audiences.settings.pause_failed'));
    }
  }

  async function handleSaveCaps() {
    setCapsError(null);
    const dailyCap = Number(caps.dailyCap);
    const hourlyCap = Number(caps.hourlyCap);
    const batchSlice = Number(caps.batchSlice);
    if (![dailyCap, hourlyCap, batchSlice].every((n) => Number.isFinite(n) && n > 0)) {
      setCapsError(t('audiences.settings.save_invalid'));
      return;
    }
    setCapsSaveState('saving');
    try {
      await update.mutateAsync({ daily_cap: dailyCap, hourly_cap: hourlyCap, batch_slice: batchSlice });
      setCapsSaveState('saved');
    } catch {
      setCapsSaveState('idle');
      setCapsError(t('audiences.settings.save_failed'));
    }
  }

  return (
    <SettingsCard className="p-5">
      <h2 className="text-base font-semibold">{t('audiences.settings.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('audiences.settings.description')}</p>

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
        <Checkbox
          id="marketing-kill-switch"
          checked={paused}
          disabled={settings.isLoading || update.isPending}
          onCheckedChange={(v) => void handlePauseToggle(v === true)}
          className="mt-0.5"
        />
        <div className="min-w-0 space-y-1">
          <Label htmlFor="marketing-kill-switch" className="font-medium">
            {t('audiences.settings.pause_all')}
          </Label>
          <p className="text-xs text-muted-foreground">{t('audiences.settings.pause_all_hint')}</p>
          {pauseError ? <p className="text-xs text-red-600 dark:text-red-400">{pauseError}</p> : null}
        </div>
      </div>

      {paused ? (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-lg border border-red-300/70 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-200"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600 dark:text-red-400" />
          {t('audiences.settings.pause_active_notice')}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="ms-daily-cap" className="text-xs">
            {t('audiences.settings.daily_cap')}
          </Label>
          <Input
            id="ms-daily-cap"
            type="number"
            min={1}
            className="mt-1 h-8 text-xs"
            value={caps.dailyCap}
            onChange={(e) => setCaps((prev) => ({ ...prev, dailyCap: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="ms-hourly-cap" className="text-xs">
            {t('audiences.settings.hourly_cap')}
          </Label>
          <Input
            id="ms-hourly-cap"
            type="number"
            min={1}
            className="mt-1 h-8 text-xs"
            value={caps.hourlyCap}
            onChange={(e) => setCaps((prev) => ({ ...prev, hourlyCap: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="ms-batch-slice" className="text-xs">
            {t('audiences.settings.batch_slice')}
          </Label>
          <Input
            id="ms-batch-slice"
            type="number"
            min={1}
            className="mt-1 h-8 text-xs"
            value={caps.batchSlice}
            onChange={(e) => setCaps((prev) => ({ ...prev, batchSlice: e.target.value }))}
          />
        </div>
      </div>

      {capsError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{capsError}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleSaveCaps()}
          disabled={settings.isLoading || update.isPending}
        >
          {t('audiences.settings.save')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {capsSaveState === 'saving'
            ? t('audiences.settings.saving')
            : capsSaveState === 'saved'
              ? t('audiences.settings.saved')
              : null}
        </span>
      </div>
    </SettingsCard>
  );
}

export function AudiencesPage() {
  const { t, i18n } = useTranslation('email_marketing');
  const { data: audiences = [], isLoading, error } = useAudiences();
  const del = useDeleteAudience();

  const [deleteTarget, setDeleteTarget] = useState<AudienceRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await del.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      // Task 1's mutations throw on ok:false — the message here is
      // audience_delete's own error code, translated below (never rendered
      // as-is; see translateDeleteError's `in_use` case).
      setDeleteError(translateDeleteError(err instanceof Error ? err.message : '', t));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <PageHeader title={t('audiences.title')} description={t('audiences.description')} />
      </SettingsCard>

      <GlobalControlsCard />

      {deleteError ? <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p> : null}

      <SettingsTableShell>
        <table className="w-full text-sm">
          <thead className={settingsTheadClass}>
            <tr>
              <th className={settingsThClass}>{t('builder.audience.name')}</th>
              <th className={settingsThClass}>{t('builder.audience.row_count')}</th>
              <th className={settingsThClass}>{t('builder.audience.consent_basis')}</th>
              <th className={settingsThClass}>{t('audiences.columns.provenance')}</th>
              <th className={settingsThClass}>{t('audiences.columns.kind')}</th>
              <th className={settingsThClass}>{t('audiences.columns.created')}</th>
              <th className={settingsThClass} aria-hidden />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={7}>
                  {t('audiences.loading')}
                </td>
              </tr>
            ) : error ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-red-600 dark:text-red-400')} colSpan={7}>
                  {error.message}
                </td>
              </tr>
            ) : audiences.length === 0 ? (
              <tr className={settingsTrClass}>
                <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={7}>
                  {t('audiences.empty')}
                </td>
              </tr>
            ) : (
              audiences.map((a) => {
                const provenance = a.source_note?.trim() || a.source_file?.trim() || null;
                return (
                  <tr key={a.id} className={settingsTrClass}>
                    <td className={settingsTdClass}>{a.name}</td>
                    <td className={cn(settingsTdClass, 'tabular-nums')}>{a.row_count}</td>
                    <td className={settingsTdClass}>
                      {t(`builder.audience.consent_basis_options.${a.consent_basis}`)}
                    </td>
                    <td className={cn(settingsTdClass, 'text-muted-foreground')}>
                      {provenance ?? t('audiences.provenance_none')}
                    </td>
                    <td className={settingsTdClass}>
                      {t(`audiences.kind.${a.kind}`, { defaultValue: t('audiences.kind_unknown', { kind: a.kind }) })}
                    </td>
                    <td className={cn(settingsTdClass, 'whitespace-nowrap text-muted-foreground')}>
                      {formatDate(a.created_at, i18n.language)}
                    </td>
                    <td className={cn(settingsTdClass, 'text-right')}>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(a)}>
                        {t('audiences.delete.button')}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </SettingsTableShell>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(next) => {
          if (!next) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={t('audiences.delete.confirm_title', { name: deleteTarget?.name ?? '' })}
        description={t('audiences.delete.confirm_text')}
        confirmLabel={t('audiences.delete.button')}
        pending={del.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
