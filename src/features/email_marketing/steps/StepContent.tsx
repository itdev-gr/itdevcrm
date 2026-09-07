import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SettingsCard } from '@/components/layout/page-shell';
// Same shared renderer the send-campaign edge function will use — deliberately
// importable from Vite as well as Deno (see the file's own header comment) so
// what the owner approves here is exactly what recipients receive. Never
// hand-roll a second renderer; src/features/email_automations/templatePreview.ts
// already establishes this exact import path for the automated-email preview.
import { renderEmailMarkup } from '../../../../supabase/functions/_shared/emailMarkup.ts';
import { useCampaign } from '../hooks/useCampaigns';
import { useUpdateCampaign } from '../hooks/useCampaignMutations';

const AUTOSAVE_DELAY_MS = 800;

type Fields = {
  subject: string;
  preheader: string;
  bodyMd: string;
  heroImageUrl: string;
  replyTo: string;
};

const EMPTY_FIELDS: Fields = { subject: '', preheader: '', bodyMd: '', heroImageUrl: '', replyTo: '' };

type Props = { campaignId: string };

export function StepContent({ campaignId }: Props) {
  const { t } = useTranslation('email_marketing');
  const { data: campaign, isLoading } = useCampaign(campaignId);
  const update = useUpdateCampaign();

  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Hydrate local state once from the loaded campaign. A ref guard keeps a
  // background refetch (e.g. after the audience step resets prepared_at)
  // from clobbering text the owner is mid-typing.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!campaign || hydrated.current) return;
    hydrated.current = true;
    setFields({
      subject: campaign.subject,
      preheader: campaign.preheader ?? '',
      bodyMd: campaign.body_md,
      heroImageUrl: campaign.hero_image_url ?? '',
      replyTo: campaign.reply_to,
    });
  }, [campaign]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function scheduleSave(next: Fields) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState('saving');
    timerRef.current = setTimeout(() => {
      update.mutate(
        {
          campaignId,
          patch: {
            subject: next.subject,
            preheader: next.preheader || null,
            body_md: next.bodyMd,
            hero_image_url: next.heroImageUrl || null,
            reply_to: next.replyTo,
          },
        },
        {
          onSuccess: () => {
            setSaveState('saved');
            setSaveError(null);
          },
          onError: () => {
            setSaveState('idle');
            setSaveError(t('builder.content.save_failed'));
          },
        },
      );
    }, AUTOSAVE_DELAY_MS);
  }

  function handleChange<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((prev) => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  }

  const preview = renderEmailMarkup(fields.bodyMd).html;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <SettingsCard className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('builder.content.title')}</h2>
          <span className="text-xs text-muted-foreground">
            {saveState === 'saving'
              ? t('builder.content.saving')
              : saveState === 'saved'
                ? t('builder.content.saved')
                : null}
          </span>
        </div>
        {saveError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{saveError}</p> : null}
        {isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('builder.content.loading')}</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="sc-subject" className="text-xs">
                {t('builder.content.subject')}
              </Label>
              <Input
                id="sc-subject"
                className="mt-1 h-8 text-xs"
                value={fields.subject}
                onChange={(e) => handleChange('subject', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sc-preheader" className="text-xs">
                {t('builder.content.preheader')}
              </Label>
              <Input
                id="sc-preheader"
                className="mt-1 h-8 text-xs"
                value={fields.preheader}
                onChange={(e) => handleChange('preheader', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sc-body" className="text-xs">
                {t('builder.content.body')}
              </Label>
              <Textarea
                id="sc-body"
                rows={12}
                className="mt-1 font-mono text-xs"
                value={fields.bodyMd}
                onChange={(e) => handleChange('bodyMd', e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t('builder.content.markup_hint')}</p>
            </div>
            <div>
              <Label htmlFor="sc-hero" className="text-xs">
                {t('builder.content.hero_image_url')}
              </Label>
              <Input
                id="sc-hero"
                className="mt-1 h-8 text-xs"
                value={fields.heroImageUrl}
                onChange={(e) => handleChange('heroImageUrl', e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div>
              <Label htmlFor="sc-reply-to" className="text-xs">
                {t('builder.content.reply_to')}
              </Label>
              <Input
                id="sc-reply-to"
                className="mt-1 h-8 text-xs"
                value={fields.replyTo}
                onChange={(e) => handleChange('replyTo', e.target.value)}
              />
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard className="p-5">
        <h2 className="text-base font-semibold">{t('builder.content.preview')}</h2>
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/25 p-4">
          {fields.heroImageUrl ? (
            <img
              src={fields.heroImageUrl}
              alt=""
              className="mb-3 max-h-40 w-full rounded-md object-cover"
            />
          ) : null}
          <div className="text-sm font-semibold">
            {fields.subject || t('builder.content.subject_placeholder')}
          </div>
          {fields.preheader ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{fields.preheader}</div>
          ) : null}
          <div
            className="mt-3 text-sm [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-bold [&_p:last-child]:mb-0 [&_p]:mb-2 [&_ul]:list-disc"
            // Safe: renderEmailMarkup HTML-escapes the source text before
            // adding its own markup tags.
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </div>
      </SettingsCard>
    </div>
  );
}
