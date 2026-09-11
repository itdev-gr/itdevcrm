import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SettingsCard } from '@/components/layout/page-shell';
// The EXACT function send-campaign/index.ts sends with — not just the body
// markup renderer, but the full card shell (greeting, hero image, footer +
// unsubscribe link). Its own header comment says it exists for this UI's
// preview. Rendering our own shell around renderEmailMarkup was reviewed and
// rejected (task-3-review.md, Important 1): the sender only emits the hero
// image when the URL starts with "https://", the real email opens with a
// greeting, and the footer/unsubscribe link is legally required — none of
// that can be hand-rolled a second time without the two silently diverging.
import { renderCampaignEmail } from '../../../../supabase/functions/send-campaign/render.ts';
import { useCampaign, useCampaignStats, CAMPAIGN_LIVE_EDITABLE_STATUSES } from '../hooks/useCampaigns';
import { useUpdateCampaign } from '../hooks/useCampaignMutations';

const AUTOSAVE_DELAY_MS = 800;

type Fields = {
  /** Internal label — never sent to anyone; it is how the campaign is found
   *  again in the list, so it is the first field on the step. */
  name: string;
  subject: string;
  preheader: string;
  bodyMd: string;
  heroImageUrl: string;
  replyTo: string;
};

const EMPTY_FIELDS: Fields = { name: '', subject: '', preheader: '', bodyMd: '', heroImageUrl: '', replyTo: '' };

type Props = { campaignId: string };

export function StepContent({ campaignId }: Props) {
  const { t } = useTranslation('email_marketing');
  const { data: campaign, isLoading } = useCampaign(campaignId);
  const update = useUpdateCampaign();

  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Content is editable while the campaign is in flight (20260911140000) —
  // the sender re-reads subject/body/hero/reply_to on every one-minute tick,
  // so a mid-send fix (a typo, a wrong price) reaches everyone not yet
  // emailed. Only the terminal statuses freeze it.
  const isEditable = campaign != null && CAMPAIGN_LIVE_EDITABLE_STATUSES.has(campaign.status);
  const locked = !isEditable;

  // Already-emailed recipients got the PREVIOUS version — an edit cannot
  // reach them. Said plainly, because it is the one thing that makes a
  // mid-flight content edit different from editing a draft.
  const stats = useCampaignStats(campaignId);
  const alreadySent = stats.data?.sent ?? 0;

  // Hydrate local state once from the loaded campaign. A ref guard keeps a
  // background refetch (e.g. after the audience step resets prepared_at)
  // from clobbering text the owner is mid-typing.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!campaign || hydrated.current) return;
    hydrated.current = true;
    setFields({
      name: campaign.name,
      subject: campaign.subject,
      preheader: campaign.preheader ?? '',
      bodyMd: campaign.body_md,
      heroImageUrl: campaign.hero_image_url ?? '',
      replyTo: campaign.reply_to,
    });
  }, [campaign]);

  // `campaign_update` rejects a blank name outright (`invalid_name`,
  // 20260907270000). Rather than fail the whole autosave — which would also
  // drop the subject/body edit the owner just made — a blank name is simply
  // left out of the patch and flagged under the field.
  function buildPatch(next: Fields) {
    const name = next.name.trim();
    return {
      ...(name ? { name } : {}),
      subject: next.subject,
      preheader: next.preheader || null,
      body_md: next.bodyMd,
      hero_image_url: next.heroImageUrl || null,
      reply_to: next.replyTo,
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
          setSaveError(t('builder.content.save_failed'));
        },
      },
    );
  }

  // "Latest" refs so the unmount-flush below (empty deps — must run exactly
  // once, on unmount) always sees the current campaignId/fields/save fn
  // without re-subscribing the effect on every render. Synced in an effect
  // (runs after commit), never during render — mutating a ref while
  // rendering is unsafe.
  const saveNowRef = useRef(saveNow);
  const latestFieldsRef = useRef(fields);
  useEffect(() => {
    saveNowRef.current = saveNow;
    latestFieldsRef.current = fields;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      // A pending debounce is FLUSHED, not dropped, when the step unmounts
      // (switching wizard steps, navigating away, closing the tab). Losing
      // the owner's last edit silently — the field just quietly reverting to
      // the old value next time he opens this step — was the review's
      // Important 2 finding. `mutate()` is safe to call after unmount in
      // React Query v5; only the onSuccess/onError setState calls above
      // become harmless no-ops.
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
    if (locked) return;
    setFields((prev) => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  }

  const previewDisplayName = t('builder.content.preview_recipient_name');
  const preview = renderCampaignEmail({
    bodyMd: fields.bodyMd,
    heroImageUrl: fields.heroImageUrl || null,
    displayName: previewDisplayName,
    unsubscribeUrl: '#',
  }).html;

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
        {!isLoading && locked ? (
          <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
            {t('builder.content.locked_notice', { status: t(`status.${campaign?.status}`) })}
          </p>
        ) : null}
        {!isLoading && !locked && alreadySent > 0 ? (
          <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
            {t('builder.content.live_edit_notice', { count: alreadySent })}
          </p>
        ) : null}
        {isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('builder.content.loading')}</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="sc-name" className="text-xs">
                {t('builder.content.name')}
              </Label>
              <Input
                id="sc-name"
                className="mt-1 h-8 text-xs"
                value={fields.name}
                onChange={(e) => handleChange('name', e.target.value)}
                disabled={locked}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {fields.name.trim()
                  ? t('builder.content.name_hint')
                  : t('builder.content.name_required')}
              </p>
            </div>
            <div>
              <Label htmlFor="sc-subject" className="text-xs">
                {t('builder.content.subject')}
              </Label>
              <Input
                id="sc-subject"
                className="mt-1 h-8 text-xs"
                value={fields.subject}
                onChange={(e) => handleChange('subject', e.target.value)}
                disabled={locked}
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
                disabled={locked}
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
                disabled={locked}
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
                disabled={locked}
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
                disabled={locked}
              />
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard className="p-5">
        <h2 className="text-base font-semibold">{t('builder.content.preview')}</h2>
        <div className="mt-3 text-sm font-semibold">
          {fields.subject || t('builder.content.subject_placeholder')}
        </div>
        {fields.preheader ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{fields.preheader}</div>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('builder.content.preview_note', { name: previewDisplayName })}
        </p>
        <div
          className="mt-2 overflow-hidden rounded-lg border border-border/60"
          // Safe: renderCampaignEmail → renderEmailMarkup HTML-escapes the
          // source text before adding its own markup tags. This is the
          // SAME html the send-campaign edge function emails — not a second,
          // hand-rolled shell — so hero-image and footer/unsubscribe
          // behaviour here always matches what recipients actually receive.
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      </SettingsCard>
    </div>
  );
}
