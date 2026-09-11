import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Eye,
  Flag,
  MousePointerClick,
  Pause,
  Play,
  Send,
  UserMinus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { useCampaign, useCampaignStats } from './hooks/useCampaigns';
import { usePauseCampaign, useResumeCampaign, useCancelCampaign } from './hooks/useCampaignMutations';
import { CampaignStatusBadge } from './components/CampaignStatusBadge';
import { SuppressionBreakdown } from './components/SuppressionBreakdown';
import { RecipientDrawer } from './components/RecipientDrawer';
import { rate, formatRate, openRateDisplay, campaignTargetCount } from './campaignCopy';

// Poll interval while a campaign is actively sending — matches the plan
// (task-5-brief.md): "Ανανέωση κάθε 15 δευτερόλεπτα όσο η κατάσταση είναι
// sending." A finished/paused/cancelled campaign must NOT keep polling, so
// the interval is only armed while `status === 'sending'` (see the effect
// below) — never for any other status, terminal or not.
const POLL_INTERVAL_MS = 15_000;

type ConfirmAction = 'pause' | 'resume' | 'cancel';

function translateActionError(message: string, t: TFunction): string {
  switch (message) {
    case 'permission_denied':
      return t('detail.controls.errors.permission_denied');
    case 'campaign_not_found':
      return t('detail.controls.errors.campaign_not_found');
    case 'invalid_state':
      return t('detail.controls.errors.invalid_state');
    default:
      return t('detail.controls.errors.generic');
  }
}

type Accent = 'default' | 'positive' | 'warn';

const ACCENT_STYLES: Record<Accent, string> = {
  default: 'bg-muted/50 text-muted-foreground',
  positive: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
};

function KpiTile({
  label,
  value,
  subtext,
  icon: Icon,
  accent = 'default',
}: {
  label: string;
  value: string;
  // Fix-pass, N-3: widened from `string | null` to `ReactNode` so the
  // "target not calculated yet" tile can carry an actual link (to the
  // builder's Review step), not just a plain caption.
  subtext?: ReactNode;
  icon: typeof Users;
  accent?: Accent;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 truncate text-2xl font-bold tracking-tight tabular-nums">{value}</p>
          {subtext ? <p className="mt-1 text-[11px] text-muted-foreground">{subtext}</p> : null}
        </div>
        <div className={cn('shrink-0 rounded-lg p-2.5', ACCENT_STYLES[accent])}>
          <Icon className="size-4" />
        </div>
      </div>
    </div>
  );
}

export function CampaignDetailPage() {
  const { t, i18n } = useTranslation('email_marketing');
  const { campaignId } = useParams();
  const nf = new Intl.NumberFormat(i18n.language);

  const { data: campaign, isLoading, error, refetch: refetchCampaign } = useCampaign(campaignId);
  const stats = useCampaignStats(campaignId);
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const cancel = useCancelCampaign();

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // --- Live polling while (and only while) the campaign is actively sending.
  // Refs so the interval isn't torn down/recreated on every render (the
  // query objects' `refetch` identity isn't guaranteed stable) — only
  // `isSending` flipping actually starts or stops the timer.
  const isSending = campaign?.status === 'sending';
  const refetchCampaignRef = useRef(refetchCampaign);
  const refetchStatsRef = useRef(stats.refetch);
  useEffect(() => {
    refetchCampaignRef.current = refetchCampaign;
    refetchStatsRef.current = stats.refetch;
  });
  useEffect(() => {
    if (!isSending) return;
    const id = setInterval(() => {
      void refetchCampaignRef.current();
      void refetchStatsRef.current();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isSending]);

  async function handleConfirm() {
    if (!confirmAction || !campaignId) return;
    setActionError(null);
    try {
      if (confirmAction === 'pause') await pause.mutateAsync(campaignId);
      else if (confirmAction === 'resume') await resume.mutateAsync(campaignId);
      else await cancel.mutateAsync(campaignId);
      setConfirmAction(null);
    } catch (err) {
      setActionError(translateActionError(err instanceof Error ? err.message : '', t));
    }
  }

  if (isLoading) {
    return (
      <SettingsCard className="p-5">
        <PageHeader title={t('detail.title')} />
        <p className="mt-3 text-sm text-muted-foreground">{t('detail.loading')}</p>
      </SettingsCard>
    );
  }

  if (error || !campaign) {
    return (
      <SettingsCard className="p-5">
        <PageHeader title={t('detail.title')} />
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error?.message ?? t('detail.not_found')}
        </p>
      </SettingsCard>
    );
  }

  const s = stats.data;
  // The real send target — see campaignCopy.ts's campaignTargetCount for the
  // full reasoning. Fix-pass, Important-2: this is now the SAME helper
  // StepReview's funnel uses, so the two screens can no longer disagree
  // about the same campaign's target mid-send. `null` (never a stale
  // number) when the campaign's last build has been invalidated
  // (`prepared_at` is null) — Important-1b.
  const target = campaignTargetCount(s, campaign.prepared_at);

  function rateSubtext(numerator: number, denominator: number, suffixKey: string): string {
    return `${formatRate(rate(numerator, denominator))} ${t(suffixKey)}`;
  }

  const canPause = campaign.status === 'sending';
  const canResume = campaign.status === 'paused';
  const canCancel = !['sent', 'cancelled'].includes(campaign.status);

  const confirmCopy: Record<ConfirmAction, { title: string; text: string; label: string }> = {
    pause: {
      title: t('detail.controls.pause_confirm_title'),
      text: t('detail.controls.pause_confirm_text'),
      label: t('detail.controls.pause'),
    },
    resume: {
      title: t('detail.controls.resume_confirm_title'),
      text: t('detail.controls.resume_confirm_text'),
      label: t('detail.controls.resume'),
    },
    cancel: {
      title: t('detail.controls.cancel_confirm_title'),
      text: t('detail.controls.cancel_confirm_text'),
      label: t('detail.controls.cancel'),
    },
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <PageHeader
          title={campaign.name}
          description={t('detail.subtitle', { subject: campaign.subject || t('detail.no_subject') })}
        >
          <CampaignStatusBadge status={campaign.status} />
          {/* The only way back into the builder for a campaign already in
              flight — content and pacing are live-editable (20260911140000)
              but there was no route to them once the wizard was left. */}
          <Link
            to={`/company/email-marketing/${campaignId}/edit`}
            className="text-sm font-medium text-primary hover:underline dark:text-[#7ad4d4]"
          >
            {t('detail.edit')}
          </Link>
          <Link
            to="/company/email-marketing"
            className="text-sm font-medium text-primary hover:underline dark:text-[#7ad4d4]"
          >
            {t('detail.back_to_list')}
          </Link>
        </PageHeader>
      </SettingsCard>

      {/* The server's bounce/complaint circuit breaker only ever writes this
          field when it auto-paused the campaign to protect the SENDING
          DOMAIN'S reputation — the same domain the company's invoice emails
          go out from. Surfaced as a loud warning banner, not a footnote. */}
      {campaign.autopause_reason ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-300/70 bg-red-50 p-4 text-sm text-red-900 shadow-sm dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-200"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <p className="font-semibold">{t('detail.autopause.title')}</p>
            <p className="mt-1">{t('detail.autopause.body', { reason: campaign.autopause_reason })}</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label={t('detail.kpi.target')}
          // Fix-pass, N-3: a genuinely null target (never built, or reset by
          // an attach/detach/import since the last build — reachable from
          // every row of the campaigns list, not just mid-edit in the
          // builder) used to render as "…" forever, reading as "still
          // loading" rather than "not calculated". `stats.isLoading` alone
          // gets the transient case; anything else null gets an explicit
          // message plus the same "go calculate it" link the builder
          // offers (Important-1a).
          value={stats.isLoading ? '…' : target === null ? t('detail.kpi.target_unknown') : nf.format(target)}
          subtext={
            !stats.isLoading && target === null ? (
              <Link
                to={`/company/email-marketing/${campaignId}/edit?step=review`}
                className="font-medium text-primary underline underline-offset-2 dark:text-[#7ad4d4]"
              >
                {t('detail.kpi.target_unknown_link')}
              </Link>
            ) : null
          }
          icon={Users}
        />
        <KpiTile
          label={t('detail.kpi.sent')}
          value={s ? nf.format(s.sent) : '…'}
          subtext={s && target !== null ? rateSubtext(s.sent, target, 'detail.kpi.of_target') : null}
          icon={Send}
        />
        <KpiTile
          label={t('detail.kpi.delivered')}
          value={s ? nf.format(s.delivered) : '…'}
          subtext={s ? rateSubtext(s.delivered, s.sent, 'detail.kpi.of_sent') : null}
          icon={CheckCircle2}
          accent="positive"
        />
        <KpiTile
          label={t('detail.kpi.bounced')}
          value={s ? nf.format(s.bounced) : '…'}
          subtext={s ? rateSubtext(s.bounced, s.sent, 'detail.kpi.of_sent') : null}
          icon={AlertTriangle}
          accent="warn"
        />
        <KpiTile
          label={t('detail.kpi.complained')}
          value={s ? nf.format(s.complained) : '…'}
          subtext={s ? rateSubtext(s.complained, s.sent, 'detail.kpi.of_sent') : null}
          icon={Flag}
          accent="warn"
        />
        <KpiTile
          label={t('detail.kpi.unsubscribed')}
          value={s ? nf.format(s.unsubscribed) : '…'}
          subtext={s ? rateSubtext(s.unsubscribed, s.sent, 'detail.kpi.of_sent') : null}
          icon={UserMinus}
        />
        {/* Open/click tracking needs a DNS record and ships in Phase 2 — it is
            OFF right now. `openRateDisplay` short-circuits on
            `trackingEnabled=false` before it ever looks at an "opened"
            count, so this always reads "δεν μετράται", never "0%" (which
            would misread as "nobody opened this campaign"). */}
        <KpiTile label={t('detail.kpi.open_rate')} value={openRateDisplay({ sent: s?.sent ?? 0 }, false)} icon={Eye} />
        <KpiTile
          label={t('detail.kpi.click_rate')}
          value={openRateDisplay({ sent: s?.sent ?? 0 }, false)}
          icon={MousePointerClick}
        />
      </div>

      <SettingsCard className="p-5">
        <h2 className="text-base font-semibold">{t('detail.controls.title')}</h2>
        {actionError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {canPause ? (
            <Button variant="outline" onClick={() => setConfirmAction('pause')}>
              <Pause className="mr-1.5 size-3.5" />
              {t('detail.controls.pause')}
            </Button>
          ) : null}
          {canResume ? (
            <Button onClick={() => setConfirmAction('resume')}>
              <Play className="mr-1.5 size-3.5" />
              {t('detail.controls.resume')}
            </Button>
          ) : null}
          {canCancel ? (
            <Button variant="destructive" onClick={() => setConfirmAction('cancel')}>
              <Ban className="mr-1.5 size-3.5" />
              {t('detail.controls.cancel')}
            </Button>
          ) : null}
          {!canPause && !canResume && !canCancel ? (
            <p className="text-sm text-muted-foreground">{t('detail.controls.none_available')}</p>
          ) : null}
        </div>
      </SettingsCard>

      <SettingsCard className="p-5">
        <h2 className="text-base font-semibold">{t('detail.suppression.title')}</h2>
        <SuppressionBreakdown byReason={s?.by_suppression_reason ?? {}} />
      </SettingsCard>

      <SettingsCard className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('detail.recipients.title')}</h2>
          <Button size="sm" variant="outline" onClick={() => setDrawerOpen(true)}>
            {t('detail.recipients.view_button')}
          </Button>
        </div>
      </SettingsCard>

      {confirmAction ? (
        <ConfirmDialog
          open={confirmAction !== null}
          onOpenChange={(o) => {
            if (!o) setConfirmAction(null);
          }}
          title={confirmCopy[confirmAction].title}
          description={confirmCopy[confirmAction].text}
          confirmLabel={confirmCopy[confirmAction].label}
          pending={pause.isPending || resume.isPending || cancel.isPending}
          onConfirm={handleConfirm}
        />
      ) : null}

      <RecipientDrawer
        open={drawerOpen}
        campaignId={campaignId ?? ''}
        campaignName={campaign.name}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
