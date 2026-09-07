import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsCard } from '@/components/layout/page-shell';
import { useCampaign, useCampaignStats } from '../hooks/useCampaigns';
import { useUpdateCampaign, useLaunchCampaign } from '../hooks/useCampaignMutations';
import { DEFAULT_DAILY_CAP, estimateCampaignCompletion } from '../scheduleEstimate';

const AUTOSAVE_DELAY_MS = 800;
const SEND_DAYS = [1, 2, 3, 4, 5, 6, 7] as const; // ISO day-of-week, matches send_days column.

type Fields = {
  dailyCap: string; // kept as raw input text; '' means "use the platform default"
  hourlyCap: string;
  sendWindowStart: string; // "HH:MM"
  sendWindowEnd: string;
  sendDays: number[];
};

const EMPTY_FIELDS: Fields = {
  dailyCap: '',
  hourlyCap: '',
  sendWindowStart: '09:00',
  sendWindowEnd: '18:00',
  sendDays: [1, 2, 3, 4, 5],
};

function toHHMM(value: string): string {
  return value.slice(0, 5);
}

function parseCapField(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function translateLaunchError(message: string, t: TFunction): string {
  switch (message) {
    case 'permission_denied':
      return t('builder.schedule.launch.errors.permission_denied');
    case 'campaign_not_found':
      return t('builder.schedule.launch.errors.campaign_not_found');
    case 'invalid_state':
      return t('builder.schedule.launch.errors.invalid_state');
    case 'not_prepared':
      return t('builder.schedule.launch.errors.not_prepared');
    case 'empty_subject':
      return t('builder.schedule.launch.errors.empty_subject');
    case 'empty_body':
      return t('builder.schedule.launch.errors.empty_body');
    case 'no_pending_recipients':
      return t('builder.schedule.launch.errors.no_pending_recipients');
    default:
      return t('builder.schedule.launch.errors.generic');
  }
}

type Props = { campaignId: string };

export function StepSchedule({ campaignId }: Props) {
  const { t, i18n } = useTranslation('email_marketing');
  const { data: campaign, isLoading } = useCampaign(campaignId);
  const stats = useCampaignStats(campaignId);
  const update = useUpdateCampaign();
  const launch = useLaunchCampaign();

  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);

  // Same hydrate-once-then-never-clobber pattern as StepContent — a
  // background refetch must not overwrite a field the owner is mid-editing.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!campaign || hydrated.current) return;
    hydrated.current = true;
    setFields({
      dailyCap: campaign.daily_cap != null ? String(campaign.daily_cap) : '',
      hourlyCap: campaign.hourly_cap != null ? String(campaign.hourly_cap) : '',
      sendWindowStart: toHHMM(campaign.send_window_start),
      sendWindowEnd: toHHMM(campaign.send_window_end),
      sendDays: campaign.send_days,
    });
  }, [campaign]);

  function buildPatch(next: Fields) {
    return {
      daily_cap: parseCapField(next.dailyCap),
      hourly_cap: parseCapField(next.hourlyCap),
      send_window_start: next.sendWindowStart,
      send_window_end: next.sendWindowEnd,
      send_days: next.sendDays,
    };
  }

  function saveNow(next: Fields) {
    update.mutate(
      { campaignId, patch: buildPatch(next) },
      {
        onSuccess: () => {
          setSaveState('saved');
          setSaveError(null);
        },
        onError: () => {
          setSaveState('idle');
          setSaveError(t('builder.schedule.save_failed'));
        },
      },
    );
  }

  // Same "latest" ref + unmount-flush idiom as StepContent — a pending
  // debounced save must be flushed, not dropped, when this step unmounts.
  const saveNowRef = useRef(saveNow);
  const latestFieldsRef = useRef(fields);
  useEffect(() => {
    saveNowRef.current = saveNow;
    latestFieldsRef.current = fields;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        saveNowRef.current(latestFieldsRef.current);
      }
    },
    [],
  );

  function scheduleSave(next: Fields) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState('saving');
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      saveNow(next);
    }, AUTOSAVE_DELAY_MS);
  }

  function handleChange<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((prev) => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  }

  function toggleSendDay(day: number) {
    setFields((prev) => {
      const has = prev.sendDays.includes(day);
      const nextDays = has ? prev.sendDays.filter((d) => d !== day) : [...prev.sendDays, day].sort();
      const next = { ...prev, sendDays: nextDays };
      scheduleSave(next);
      return next;
    });
  }

  // The final target count — the SAME real number used for both the
  // estimate below and the launch confirmation's exact-count sentence, taken
  // from campaign_stats (kept fresh: build_campaign_recipients and
  // campaign_launch both invalidate it) rather than anything computed or
  // cached locally in this step.
  const targetCount = stats.data?.by_status?.pending ?? 0;
  const parsedDailyCap = parseCapField(fields.dailyCap);
  const effectiveDailyCap = parsedDailyCap ?? DEFAULT_DAILY_CAP;
  const estimate = estimateCampaignCompletion(targetCount, effectiveDailyCap);
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' });
  const nf = new Intl.NumberFormat(i18n.language);

  async function confirmLaunch() {
    setLaunchError(null);
    try {
      await launch.mutateAsync(campaignId);
      setConfirmOpen(false);
      setLaunched(true);
    } catch (err) {
      setConfirmOpen(false);
      setLaunchError(translateLaunchError(err instanceof Error ? err.message : '', t));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('builder.schedule.title')}</h2>
          <span className="text-xs text-muted-foreground">
            {saveState === 'saving'
              ? t('builder.schedule.saving')
              : saveState === 'saved'
                ? t('builder.schedule.saved')
                : null}
          </span>
        </div>
        {saveError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{saveError}</p> : null}

        {isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('builder.schedule.loading')}</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ss-daily-cap" className="text-xs">
                  {t('builder.schedule.daily_cap')}
                </Label>
                <Input
                  id="ss-daily-cap"
                  type="number"
                  min={1}
                  className="mt-1 h-8 text-xs"
                  placeholder={t('builder.schedule.daily_cap_placeholder', { default: DEFAULT_DAILY_CAP })}
                  value={fields.dailyCap}
                  onChange={(e) => handleChange('dailyCap', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ss-hourly-cap" className="text-xs">
                  {t('builder.schedule.hourly_cap')}
                </Label>
                <Input
                  id="ss-hourly-cap"
                  type="number"
                  min={1}
                  className="mt-1 h-8 text-xs"
                  placeholder={t('builder.schedule.hourly_cap_placeholder')}
                  value={fields.hourlyCap}
                  onChange={(e) => handleChange('hourlyCap', e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">{t('builder.schedule.send_window')}</Label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  aria-label={t('builder.schedule.send_window_start_label')}
                  type="time"
                  className="h-8 w-auto text-xs"
                  value={fields.sendWindowStart}
                  onChange={(e) => handleChange('sendWindowStart', e.target.value)}
                />
                <span className="text-xs text-muted-foreground">{t('builder.schedule.send_window_to')}</span>
                <Input
                  aria-label={t('builder.schedule.send_window_end_label')}
                  type="time"
                  className="h-8 w-auto text-xs"
                  value={fields.sendWindowEnd}
                  onChange={(e) => handleChange('sendWindowEnd', e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">{t('builder.schedule.send_days')}</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SEND_DAYS.map((day) => {
                  const active = fields.sendDays.includes(day);
                  return (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      aria-pressed={active}
                      onClick={() => toggleSendDay(day)}
                    >
                      {t(`builder.schedule.days.${day}`)}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              {targetCount === 0 ? (
                <p className="text-muted-foreground">{t('builder.schedule.estimate.no_recipients')}</p>
              ) : estimate === null ? (
                <p className="text-muted-foreground">{t('builder.schedule.estimate.unavailable')}</p>
              ) : estimate.days === 1 ? (
                <p>{t('builder.schedule.estimate.same_day', { cap: nf.format(effectiveDailyCap) })}</p>
              ) : (
                <p>
                  {t('builder.schedule.estimate.future', {
                    cap: nf.format(effectiveDailyCap),
                    date: dateFmt.format(estimate.date),
                    days: estimate.days,
                  })}
                </p>
              )}
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard className="p-5">
        <h2 className="text-base font-semibold">{t('builder.schedule.launch.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('builder.schedule.launch.description')}</p>

        {launchError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{launchError}</p> : null}
        {launched ? (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{t('builder.schedule.launch.success')}</p>
        ) : null}

        <div className="mt-3">
          <Button
            variant="destructive"
            onClick={() => {
              setLaunchError(null);
              setConfirmOpen(true);
            }}
            disabled={launch.isPending}
          >
            {t('builder.schedule.launch.button')}
          </Button>
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('builder.schedule.launch.confirm_title')}
        description={t('builder.schedule.launch.confirm_text', { count: nf.format(targetCount) })}
        confirmLabel={t('builder.schedule.launch.button')}
        pending={launch.isPending}
        onConfirm={confirmLaunch}
      />
    </div>
  );
}
