import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/authStore';
import { useCampaign, useCampaignStats } from '../hooks/useCampaigns';
import { useBuildCampaignRecipients } from '../hooks/useCampaignMutations';
import { useTestSendCampaign } from '../hooks/useTestSendCampaign';
import { RecipientFunnel } from '../components/RecipientFunnel';
import { SuppressionBreakdown } from '../components/SuppressionBreakdown';
import { campaignTargetCount } from '../campaignCopy';

type Props = { campaignId: string };

type BuildResult = { built: number; suppressed: number; byReason: Record<string, number> };

function translateBuildError(message: string, t: TFunction): string {
  switch (message) {
    case 'permission_denied':
      return t('builder.review.build_errors.permission_denied');
    case 'campaign_not_found':
      return t('builder.review.build_errors.campaign_not_found');
    case 'not_draft':
      return t('builder.review.build_errors.not_draft');
    default:
      return t('builder.review.build_errors.generic');
  }
}

function translateTestSendError(message: string | null | undefined, t: TFunction): string {
  switch (message) {
    case 'invalid_recipient':
      return t('builder.review.test_send.failed_invalid_recipient');
    case 'campaign_not_found':
      return t('builder.review.test_send.failed_campaign_not_found');
    case 'identity_not_marketing':
      return t('builder.review.test_send.failed_identity_not_marketing');
    case 'Unauthorized':
    case 'Forbidden':
      return t('builder.review.test_send.failed_unauthorized');
    default:
      // Covers everything else, including the send-campaign edge function
      // not being deployed yet (a FunctionsFetchError, not one of the codes
      // above) — a readable Greek sentence, never a raw error/crash.
      return t('builder.review.test_send.failed_unavailable');
  }
}

export function StepReview({ campaignId }: Props) {
  const { t } = useTranslation('email_marketing');
  const userEmail = useAuthStore((s) => s.user?.email ?? null);
  const { data: campaign } = useCampaign(campaignId);
  const stats = useCampaignStats(campaignId);
  const build = useBuildCampaignRecipients();
  const testSend = useTestSendCampaign();

  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  async function handleBuild() {
    setBuildError(null);
    try {
      const result = await build.mutateAsync(campaignId);
      setBuildResult({ built: result.built, suppressed: result.suppressed, byReason: result.by_reason });
    } catch (err) {
      setBuildError(translateBuildError(err instanceof Error ? err.message : '', t));
    }
  }

  async function handleTestSend() {
    if (!userEmail) return;
    setTestState('idle');
    setTestMessage(null);
    try {
      const result = await testSend.mutateAsync({ campaignId, to: userEmail });
      if (result.ok) {
        setTestState('success');
        setTestMessage(t('builder.review.test_send.success', { to: userEmail }));
      } else {
        setTestState('error');
        setTestMessage(translateTestSendError(result.error, t));
      }
    } catch (err) {
      setTestState('error');
      setTestMessage(translateTestSendError(err instanceof Error ? err.message : null, t));
    }
  }

  // Fall back to the campaign's already-persisted stats (a build from a
  // previous session, or before this step remounted) when nothing has been
  // (re)built in THIS session yet — so reopening the wizard on this step
  // never shows a blank slate for a campaign that's actually already 'ready'.
  //
  // Fix-pass, Important-1b/Important-2: the fallback goes through the SAME
  // campaignTargetCount() helper CampaignDetailPage uses (sum minus
  // suppressed, not by_status.pending alone) — the old pending-only fallback
  // read a shrinking number once sending started and a flat, false "0" on a
  // finished campaign, reachable just by reopening this step from browser
  // history. It also returns null (not a stale number) once prepared_at has
  // been cleared by an attach/detach/import since the last build.
  const statsTarget = campaignTargetCount(stats.data, campaign?.prepared_at ?? null);
  const built = buildResult?.built ?? statsTarget ?? 0;
  const suppressedFromStats = Object.values(stats.data?.by_suppression_reason ?? {}).reduce(
    (sum, n) => sum + n,
    0,
  );
  const suppressed = buildResult?.suppressed ?? suppressedFromStats;
  const byReason = buildResult?.byReason ?? stats.data?.by_suppression_reason ?? {};
  const hasNumbers = buildResult !== null || statsTarget !== null;
  // Recipient rows exist server-side (a build happened at some point) but
  // prepared_at is null (attach/detach/import since) — the persisted
  // by_status numbers are real rows, just no longer the campaign's current
  // build. Showing them as the funnel would be exactly the stale-number
  // trap Important-1b calls out; showing an honest "needs recalculating"
  // notice instead.
  const totalRecipientRows = Object.values(stats.data?.by_status ?? {}).reduce((sum, n) => sum + n, 0);
  const isStale = buildResult === null && campaign != null && campaign.prepared_at == null && totalRecipientRows > 0;

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t('builder.review.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('builder.review.description')}</p>
          </div>
          <Button size="sm" onClick={handleBuild} disabled={build.isPending}>
            {build.isPending ? t('builder.review.calculating') : t('builder.review.calculate_button')}
          </Button>
        </div>

        {buildError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{buildError}</p> : null}

        {stats.isLoading && !hasNumbers && !isStale ? (
          <p className="mt-4 text-sm text-muted-foreground">{t('builder.review.loading')}</p>
        ) : isStale ? (
          <p className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
            {t('builder.review.stale_notice')}
          </p>
        ) : hasNumbers ? (
          <div className="mt-4">
            <RecipientFunnel built={built} suppressed={suppressed} />
            {suppressed > 0 ? (
              <div className="mt-4">
                <h3 className="text-sm font-semibold">{t('builder.review.suppression.title')}</h3>
                <SuppressionBreakdown byReason={byReason} />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t('builder.review.no_numbers_yet')}</p>
        )}
      </SettingsCard>

      <SettingsCard className="p-5">
        <h2 className="text-base font-semibold">{t('builder.review.test_send.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {userEmail
            ? t('builder.review.test_send.to_label', { to: userEmail })
            : t('builder.review.test_send.no_email')}
        </p>
        <div className="mt-3">
          <Button size="sm" onClick={handleTestSend} disabled={testSend.isPending || !userEmail}>
            {testSend.isPending ? t('builder.review.test_send.sending') : t('builder.review.test_send.button')}
          </Button>
        </div>
        {testMessage ? (
          <p
            className={cn(
              'mt-2 text-sm',
              testState === 'success' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
            )}
          >
            {testMessage}
          </p>
        ) : null}
      </SettingsCard>
    </div>
  );
}
