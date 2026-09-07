import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/authStore';
import { useCampaignStats } from '../hooks/useCampaigns';
import { useBuildCampaignRecipients } from '../hooks/useCampaignMutations';
import { useTestSendCampaign } from '../hooks/useTestSendCampaign';
import { RecipientFunnel } from '../components/RecipientFunnel';
import { SuppressionBreakdown } from '../components/SuppressionBreakdown';

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
  const built = buildResult?.built ?? stats.data?.by_status?.pending ?? 0;
  const suppressedFromStats = Object.values(stats.data?.by_suppression_reason ?? {}).reduce(
    (sum, n) => sum + n,
    0,
  );
  const suppressed = buildResult?.suppressed ?? suppressedFromStats;
  const byReason = buildResult?.byReason ?? stats.data?.by_suppression_reason ?? {};
  const hasNumbers = buildResult !== null || stats.data !== undefined;

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

        {stats.isLoading && !hasNumbers ? (
          <p className="mt-4 text-sm text-muted-foreground">{t('builder.review.loading')}</p>
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
