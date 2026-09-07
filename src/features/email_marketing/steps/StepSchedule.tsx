import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsCard } from '@/components/layout/page-shell';
import {
  useCampaign,
  useCampaigns,
  useCampaignStats,
  useEmailMarketingSettings,
  CAMPAIGN_EDITABLE_STATUSES,
  CAMPAIGN_LAUNCHABLE_STATUSES,
} from '../hooks/useCampaigns';
import { useUpdateCampaign, useLaunchCampaign } from '../hooks/useCampaignMutations';
import { campaignTargetCount } from '../campaignCopy';
import { DEFAULT_DAILY_CAP, DEFAULT_WARMUP_LADDER, estimateCampaignCompletion } from '../scheduleEstimate';

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

/** Parses a Postgres `date` column ("YYYY-MM-DD", no time/timezone) as a
 *  LOCAL calendar date — NOT `new Date(s)`, which ISO-8601 date-only parsing
 *  treats as UTC midnight and can silently roll back a day once converted to
 *  a timezone behind UTC. */
function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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

type Props = {
  campaignId: string;
  /** Jumps the builder back to step 3 ("Έλεγχος") — offered next to the
   *  launch button when the campaign is `draft` (Important-1a): the
   *  recipient list needs recalculating before it can launch, and the
   *  owner should be one click from doing that, not left to guess which
   *  tab fixes it. Optional so this component still renders standalone in
   *  tests that don't care about step navigation. */
  onGoToReview?: () => void;
};

export function StepSchedule({ campaignId, onGoToReview }: Props) {
  const { t, i18n } = useTranslation('email_marketing');
  const { data: campaign, isLoading } = useCampaign(campaignId);
  const stats = useCampaignStats(campaignId);
  const settings = useEmailMarketingSettings();
  // Fix-pass, Important-5: campaign_daily_budget paces DOMAIN-WIDE, not per
  // campaign — reused, not a new query, so this shares the same cache
  // CampaignsListPage already populates.
  const allCampaigns = useCampaigns();
  const update = useUpdateCampaign();
  const launch = useLaunchCampaign();

  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);

  // Once the campaign leaves draft/ready (launched from here, or from
  // anywhere else — reopening this step later sees it via `campaign.status`
  // just as readily as the local `launched` flag does), campaign_update
  // itself refuses every write (20260907270000:103-105). The controls must
  // be visibly frozen instead of silently failing on the next edit.
  const isEditable = campaign != null && CAMPAIGN_EDITABLE_STATUSES.has(campaign.status);
  // `launched` is folded in directly (not just `isEditable`, which reflects
  // `campaign.status` from the query cache) so the controls lock immediately
  // on a successful launch in THIS session, without waiting on the
  // invalidated `campaign` query's refetch to land first.
  const locked = !isEditable || launched;

  // Fix-pass, Important-1a: `campaign_launch` only accepts ready|scheduled —
  // a NARROWER set than the draft|ready the pacing fields stay editable
  // under. A `draft` campaign is still editable here (its pacing fields can
  // be tuned) but is never launchable: attaching/detaching an audience,
  // editing the segment, or importing into an attached audience all reset
  // the campaign to `draft` without deleting the old recipient rows, so
  // "launch" must be blocked and explained, not offered against a stale
  // build the server would reject anyway.
  const isLaunchableStatus = campaign != null && CAMPAIGN_LAUNCHABLE_STATUSES.has(campaign.status);
  const isDraftNotReady = campaign != null && campaign.status === 'draft';

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

  // Awaitable save, used both by the debounced timeout (fire-and-forget) and
  // by the pre-launch flush (awaited — fix-pass, Important-2) so a launch
  // can know whether the latest edit actually landed before it proceeds.
  async function saveNowAsync(next: Fields): Promise<void> {
    try {
      await update.mutateAsync({ campaignId, patch: buildPatch(next) });
      setSaveState('saved');
      setSaveError(null);
    } catch {
      setSaveState('idle');
      setSaveError(t('builder.schedule.save_failed'));
      throw new Error('save_failed');
    }
  }

  // "Latest" refs so the unmount-flush/pre-launch-flush below always see the
  // current fields/save fn without re-subscribing on every render.
  const saveNowAsyncRef = useRef(saveNowAsync);
  const latestFieldsRef = useRef(fields);
  useEffect(() => {
    saveNowAsyncRef.current = saveNowAsync;
    latestFieldsRef.current = fields;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void saveNowAsyncRef.current(latestFieldsRef.current);
      }
    },
    [],
  );

  function scheduleSave(next: Fields) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState('saving');
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveNowAsync(next);
    }, AUTOSAVE_DELAY_MS);
  }

  function handleChange<K extends keyof Fields>(key: K, value: Fields[K]) {
    if (locked) return;
    setFields((prev) => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  }

  function toggleSendDay(day: number) {
    if (locked) return;
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
  //
  // Fix-pass, Critical-1: `null` means "not actually known yet" (the query
  // hasn't resolved, or failed) — deliberately NEVER collapsed to 0. A cold
  // cache (direct navigation to this step) or an errored stats fetch must
  // block the launch, not silently confirm a send to "0 people" while
  // campaign_launch sends to everyone still pending.
  // Fix-pass, Important-1b/Important-2: routed through the SAME
  // campaignTargetCount() helper StepReview and CampaignDetailPage use — a
  // `prepared_at` of null (an attach/detach/import reset the campaign to
  // draft without deleting the old recipient rows) collapses this to null
  // too, exactly like an unresolved/errored query, rather than showing a
  // stale number the launch confirmation would then repeat as a promise.
  const targetCount: number | null = (() => {
    if (stats.isLoading || stats.isError || !stats.data) return null;
    return campaignTargetCount(stats.data, campaign?.prepared_at ?? null);
  })();

  // Fix-pass, Minor-1: the effective cap/ladder now come from the LIVE
  // email_marketing_settings row when it has loaded, not a hardcoded mirror
  // of the schema default — so lowering the platform cap is reflected here
  // without a code change. Falls back to the schema-default constants only
  // while settings is still loading/erroring (never blocks the estimate on
  // a second query).
  const parsedDailyCap = parseCapField(fields.dailyCap);
  const liveDailyCap = settings.data?.daily_cap ?? DEFAULT_DAILY_CAP;
  const effectiveDailyCap = parsedDailyCap ?? liveDailyCap;
  const warmupLadder = settings.data?.warmup_ladder ?? DEFAULT_WARMUP_LADDER;
  // Second fix-pass (task-4-review-2.md): null here (settings not loaded
  // yet, OR loaded and genuinely still unset) means "assume warm-up starts
  // today" — the honest assumption once 20260907280000 is applied, since
  // launching today is exactly what would start it. A real date means the
  // ladder is already mid-climb and the estimate must index from THAT date,
  // not from today.
  const warmupStartedOn = settings.data?.warmup_started_on ? parseDateOnly(settings.data.warmup_started_on) : null;
  const estimate =
    targetCount === null
      ? null
      : estimateCampaignCompletion(
          targetCount,
          { dailyCap: effectiveDailyCap, sendDays: fields.sendDays, warmupLadder, warmupStartedOn },
          new Date(),
        );
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' });
  const nf = new Intl.NumberFormat(i18n.language);

  // Fix-pass, Important-5: campaign_daily_budget counts sends DOMAIN-WIDE
  // (supabase/migrations/20260907220000_campaign_queue_ops.sql:135-142), but
  // the day-by-day walk above assumes the whole daily allowance belongs to
  // THIS campaign alone. With another campaign already sending, the real
  // pacer splits the allowance between them and the true finish is later —
  // the one direction this screen exists to protect against. Rather than
  // model the split (which would require guessing the other campaign's own
  // remaining volume), the estimate is presented as an honest FLOOR with a
  // caveat when this is detected.
  const otherCampaignSending = (allCampaigns.data ?? []).some((c) => c.id !== campaignId && c.status === 'sending');

  // Fix-pass, Important-4: `paused` is already fetched via
  // useEmailMarketingSettings (used above for daily_cap/warmup_ladder) but
  // was never surfaced — a paused-globally launch used to succeed silently,
  // leaving the dashboard frozen at "Στάλθηκαν 0" with no explanation. Shown
  // plainly, never used to block the launch itself (the campaign IS created
  // and DOES start sending once sending resumes — that's true and worth
  // saying, not a reason to disable the button).
  const isPaused = settings.data?.paused === true;

  async function confirmLaunch() {
    setLaunchError(null);

    // Fix-pass, Important-2: a pending debounced cap/window/days save must
    // land before launch — otherwise the campaign launches on whatever was
    // last PERSISTED, not what the owner just approved in the estimate box,
    // and the late save then dies against the now-'sending' campaign with an
    // opaque failure. Flush and await it first; abort the launch (leave the
    // dialog closed, show the save error) rather than launch against a
    // schedule that didn't actually save.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      try {
        await saveNowAsync(latestFieldsRef.current);
      } catch {
        setConfirmOpen(false);
        return;
      }
    }

    try {
      await launch.mutateAsync(campaignId);
      setConfirmOpen(false);
      setLaunched(true);
    } catch (err) {
      setConfirmOpen(false);
      setLaunchError(translateLaunchError(err instanceof Error ? err.message : '', t));
    }
  }

  // Fix-pass, Important-1a: `!isLaunchableStatus` blocks launching a `draft`
  // campaign even though its pacing fields remain editable — see the
  // isLaunchableStatus comment above for why draft and launchable are
  // deliberately different sets.
  const launchDisabled = launch.isPending || locked || !isLaunchableStatus || targetCount === null;

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

        {!isLoading && !isEditable ? (
          <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
            {t('builder.schedule.locked_notice', { status: t(`status.${campaign?.status}`) })}{' '}
            <Link to="/company/email-marketing" className="font-medium underline underline-offset-2">
              {t('builder.schedule.back_to_list')}
            </Link>
          </p>
        ) : null}

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
                  placeholder={t('builder.schedule.daily_cap_placeholder', { capDefault: liveDailyCap })}
                  value={fields.dailyCap}
                  onChange={(e) => handleChange('dailyCap', e.target.value)}
                  disabled={locked}
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
                  disabled={locked}
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
                  disabled={locked}
                />
                <span className="text-xs text-muted-foreground">{t('builder.schedule.send_window_to')}</span>
                <Input
                  aria-label={t('builder.schedule.send_window_end_label')}
                  type="time"
                  className="h-8 w-auto text-xs"
                  value={fields.sendWindowEnd}
                  onChange={(e) => handleChange('sendWindowEnd', e.target.value)}
                  disabled={locked}
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
                      disabled={locked}
                    >
                      {t(`builder.schedule.days.${day}`)}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              {targetCount === null ? (
                <p className="text-muted-foreground">
                  {isDraftNotReady
                    ? t('builder.schedule.estimate.not_ready')
                    : stats.isError
                      ? t('builder.schedule.estimate.stats_error')
                      : t('builder.schedule.estimate.stats_loading')}
                </p>
              ) : targetCount === 0 ? (
                <p className="text-muted-foreground">{t('builder.schedule.estimate.no_recipients')}</p>
              ) : estimate === null ? (
                <p className="text-muted-foreground">{t('builder.schedule.estimate.unavailable')}</p>
              ) : estimate.days === 1 ? (
                <p>
                  {t(
                    otherCampaignSending ? 'builder.schedule.estimate.same_day_shared' : 'builder.schedule.estimate.same_day',
                    { cap: nf.format(effectiveDailyCap) },
                  )}
                </p>
              ) : (
                <p>
                  {t(
                    otherCampaignSending ? 'builder.schedule.estimate.future_shared' : 'builder.schedule.estimate.future',
                    {
                      cap: nf.format(effectiveDailyCap),
                      date: dateFmt.format(estimate.date),
                      days: estimate.days,
                    },
                  )}
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
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
            {t('builder.schedule.launch.success')}{' '}
            <Link to="/company/email-marketing" className="font-medium underline underline-offset-2">
              {t('builder.schedule.back_to_list')}
            </Link>
          </p>
        ) : null}

        {/* Fix-pass, Important-1a: shown whenever the campaign is `draft` —
            independent of targetCount, since a draft's stale/null count is
            a SYMPTOM of the same reset, not a separate problem. */}
        {!launched && isDraftNotReady ? (
          <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
            {t('builder.schedule.launch.not_ready_notice')}{' '}
            {onGoToReview ? (
              <button
                type="button"
                onClick={onGoToReview}
                className="font-medium underline underline-offset-2"
              >
                {t('builder.schedule.launch.go_to_review')}
              </button>
            ) : null}
          </p>
        ) : null}
        {!launched && !isDraftNotReady && targetCount === null ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('builder.schedule.launch.count_unknown')}</p>
        ) : null}

        {/* Fix-pass, Important-4: the global kill switch is invisible
            nowhere else on this screen — shown plainly, next to the button
            that would otherwise launch straight into it, but never used to
            disable the button itself (the launch DOES succeed; nothing
            sends until sending resumes, and that is worth saying, not
            hiding). */}
        {isPaused ? (
          <p className="mt-3 rounded-lg border border-red-300/70 bg-red-50 p-2.5 text-sm text-red-900 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-200">
            {t('builder.schedule.launch.paused_notice')}
          </p>
        ) : null}

        <div className="mt-3">
          <Button
            variant="destructive"
            onClick={() => {
              setLaunchError(null);
              setConfirmOpen(true);
            }}
            disabled={launchDisabled}
          >
            {t('builder.schedule.launch.button')}
          </Button>
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={confirmOpen && targetCount !== null}
        onOpenChange={setConfirmOpen}
        title={t('builder.schedule.launch.confirm_title')}
        description={
          isPaused
            ? `${t('builder.schedule.launch.confirm_text', { count: nf.format(targetCount ?? 0) })} ${t('builder.schedule.launch.confirm_paused_suffix')}`
            : t('builder.schedule.launch.confirm_text', { count: nf.format(targetCount ?? 0) })
        }
        confirmLabel={t('builder.schedule.launch.button')}
        pending={launch.isPending}
        onConfirm={confirmLaunch}
      />
    </div>
  );
}
