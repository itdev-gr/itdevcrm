import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { useCampaign } from './hooks/useCampaigns';
import { useCreateCampaign } from './hooks/useCampaignMutations';
import { StepContent } from './steps/StepContent';
import { StepAudience } from './steps/StepAudience';

const STEPS = ['content', 'audience', 'review', 'schedule'] as const;
type Step = (typeof STEPS)[number];

/** Four-step wizard shell: content → audience → review → schedule. Steps 3-4
 *  (StepReview/StepSchedule) are Task 4 — their slots stay in the stepper so
 *  the nav layout doesn't change later, but they render a placeholder. */
export function CampaignBuilderPage() {
  const { t } = useTranslation('email_marketing');
  const navigate = useNavigate();
  const { campaignId } = useParams();
  const createCampaign = useCreateCampaign();
  const [createError, setCreateError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('content');

  // The `/new` route has no campaignId yet — create one immediately and move
  // to the `/edit` route, so every step component below always has a real
  // campaignId to save against (mirrors CampaignsListPage's own "+ Νέα
  // καμπάνια" → campaign_create → navigate flow).
  const creatingRef = useRef(false);
  useEffect(() => {
    if (campaignId || creatingRef.current) return;
    creatingRef.current = true;
    createCampaign.mutate(
      { name: t('list.new_campaign_default_name') },
      {
        onSuccess: (result) => {
          navigate(`/company/email-marketing/${result.campaign_id}/edit`, { replace: true });
        },
        onError: () => {
          creatingRef.current = false;
          setCreateError(t('errors.create_failed'));
        },
      },
    );
  }, [campaignId, createCampaign, navigate, t]);

  const { data: campaign } = useCampaign(campaignId);

  if (!campaignId) {
    return (
      <SettingsCard className="p-5">
        <PageHeader title={t('builder.new_title')} />
        {createError ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{createError}</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t('builder.creating')}</p>
        )}
      </SettingsCard>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <PageHeader title={campaign?.name || t('builder.edit_title')} description={t('builder.description')} />
        <nav className="mt-4 flex flex-wrap gap-1.5" aria-label={t('builder.steps_nav_label')}>
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              aria-current={step === s ? 'step' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                step === s
                  ? 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-[#7ad4d4]'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {i + 1}. {t(`builder.steps.${s}`)}
            </button>
          ))}
        </nav>
      </SettingsCard>

      {step === 'content' && <StepContent campaignId={campaignId} />}
      {step === 'audience' && <StepAudience campaignId={campaignId} />}
      {step === 'review' && (
        <SettingsCard className="p-5">
          <p className="text-sm text-muted-foreground">{t('builder.steps_coming_soon.review')}</p>
        </SettingsCard>
      )}
      {step === 'schedule' && (
        <SettingsCard className="p-5">
          <p className="text-sm text-muted-foreground">{t('builder.steps_coming_soon.schedule')}</p>
        </SettingsCard>
      )}
    </div>
  );
}
