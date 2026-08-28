import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Pencil, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  PageHeader,
  SettingsCard,
  SettingsTableShell,
  settingsTdClass,
  settingsThClass,
  settingsTheadClass,
  settingsTrClass,
} from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { templatePreviewHtml, templateSupportsMarkup } from './templatePreview';
import {
  useEmailTemplates,
  useUpdateEmailTemplate,
  useAutomationSettings,
  useUpdateAutomationSetting,
  useEmailSequences,
  useUpdateSequence,
  useUpdateSequenceStep,
  type EmailTemplateRow,
} from './hooks/useEmailAutomations';

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
  );
}

function TemplateEditor({ tpl }: { tpl: EmailTemplateRow }) {
  const { t } = useTranslation('admin');
  const update = useUpdateEmailTemplate();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(tpl.subject);
  const [body, setBody] = useState(tpl.body);
  const dirty = subject !== tpl.subject || body !== tpl.body;
  // Offer composer rows (offer_* / ud_offer_*) are assembled client-side by
  // offerEmailBody.ts (textToHtml) and never pass through the shared markup
  // renderer, so **bold** / "## " / "- " markup never renders for them.
  const supportsMarkup = templateSupportsMarkup(tpl.key);

  // Reset the draft to the current template each time the popup opens.
  function openDialog() {
    setSubject(tpl.subject);
    setBody(tpl.body);
    setOpen(true);
  }

  return (
    <>
      <SettingsCard className="overflow-hidden">
        <button
          type="button"
          onClick={openDialog}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/35"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{tpl.subject}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {tpl.description} · <code className="text-[10px]">{tpl.key}</code>
            </div>
          </div>
          <Pencil className="ml-3 size-4 shrink-0 text-muted-foreground" />
        </button>
      </SettingsCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('email_automations.edit_email')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* When it's sent (trigger/timing) + sender info */}
            <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('email_automations.when_sent')}
              </div>
              <div className="mt-1 text-sm">{tpl.description}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <code className="rounded bg-muted px-1">{tpl.key}</code>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-medium',
                    tpl.client_facing
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {tpl.client_facing
                    ? t('email_automations.client_facing')
                    : t('email_automations.internal')}
                </span>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {t('email_automations.subject')}
              </label>
              <Input className="mt-1.5" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {t('email_automations.body')}
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="mt-1.5 block w-full rounded-lg border border-input/80 bg-background px-3 py-2 font-mono text-xs shadow-sm focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
              />
              {supportsMarkup && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t('email_automations.markup_hint')}
                </p>
              )}
            </div>
            {tpl.variables && (
              <p className="text-xs text-muted-foreground">
                {t('email_automations.variables')}:{' '}
                {tpl.variables.split(',').map((v) => (
                  <code key={v} className="mr-1 rounded bg-muted px-1">
                    {`{{${v.trim()}}}`}
                  </code>
                ))}
              </p>
            )}
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('email_automations.preview', { defaultValue: 'Προεπισκόπηση' })}
              </div>
              <div
                className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-border/60 bg-muted/25 p-3 text-sm [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-bold"
                // Safe: both the shared renderer and textToHtml() escape the template
                // text before adding markup tags.
                dangerouslySetInnerHTML={{ __html: templatePreviewHtml(body, tpl.key) }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" disabled={!dirty} onClick={openDialog}>
              {t('email_automations.reset')}
            </Button>
            <Button
              disabled={!dirty || update.isPending}
              onClick={() =>
                update.mutate(
                  { key: tpl.key, subject, body },
                  { onSuccess: () => setOpen(false) },
                )
              }
            >
              {t('email_automations.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EmailAutomationsPage() {
  const { t } = useTranslation('admin');
  const { data: settings = [] } = useAutomationSettings();
  const { data: sequences = [] } = useEmailSequences();
  const { data: templates = [] } = useEmailTemplates();
  const updateSetting = useUpdateAutomationSetting();
  const updateSequence = useUpdateSequence();
  const updateStep = useUpdateSequenceStep();

  const DEPT_KEYS = ['dept_sales', 'dept_accounting', 'dept_technical'];
  const DEPT_LABELS: Record<string, string> = {
    dept_sales: t('email_automations.dept_sales'),
    dept_accounting: t('email_automations.dept_accounting'),
    dept_technical: t('email_automations.dept_technical'),
  };
  const globalRow = settings.find((s) => s.key === 'global');
  const departments = DEPT_KEYS.map((k) => settings.find((s) => s.key === k)).filter(
    (s): s is NonNullable<typeof s> => Boolean(s),
  );
  const oneShots = settings.filter((s) => s.key !== 'global' && !DEPT_KEYS.includes(s.key));
  const templateByKey = new Map(templates.map((tp) => [tp.key, tp]));

  return (
    <div className="space-y-5">
      <PageHeader title={t('email_automations.title')}>
        {globalRow && (
          <label
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-sm',
              globalRow.enabled
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-red-500/30 bg-red-500/5',
            )}
          >
            <Toggle
              checked={globalRow.enabled}
              onChange={(v) => updateSetting.mutate({ key: 'global', enabled: v })}
            />
            <Power className="size-3.5 opacity-70" />
            <span className={globalRow.enabled ? 'font-medium' : 'font-medium text-red-600 dark:text-red-400'}>
              {t('email_automations.global_switch')}
            </span>
          </label>
        )}
      </PageHeader>

      {departments.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{t('email_automations.departments')}</h2>
          <SettingsCard className="divide-y divide-border/60">
            {departments.map((s) => (
              <label
                key={s.key}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/25"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{DEPT_LABELS[s.key] ?? s.key}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{s.description}</div>
                </div>
                <Toggle
                  checked={s.enabled}
                  onChange={(v) => updateSetting.mutate({ key: s.key, enabled: v })}
                />
              </label>
            ))}
          </SettingsCard>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t('email_automations.one_shots')}</h2>
        <SettingsCard className="divide-y divide-border/60">
          {oneShots.map((s) => (
            <label key={s.key} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/25">
              <span className="text-sm">{s.description}</span>
              <Toggle
                checked={s.enabled}
                onChange={(v) => updateSetting.mutate({ key: s.key, enabled: v })}
              />
            </label>
          ))}
        </SettingsCard>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t('email_automations.sequences')}</h2>
        <div className="space-y-3">
          {sequences.map((seq) => (
            <SettingsCard key={seq.id} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/60 bg-muted/25 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Mail className="size-4 text-primary dark:text-[#7ad4d4]" />
                    {seq.display_name}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{seq.description}</div>
                </div>
                <Toggle
                  checked={seq.enabled}
                  onChange={(v) => updateSequence.mutate({ id: seq.id, enabled: v })}
                />
              </div>
              <SettingsTableShell className="rounded-none border-0 shadow-none">
                <table className="w-full text-sm">
                  <thead className={settingsTheadClass}>
                    <tr>
                      <th className={settingsThClass}>{t('email_automations.step_day')}</th>
                      <th className={settingsThClass}>{t('email_automations.step_email')}</th>
                      <th className={`${settingsThClass} text-right`}>
                        {t('email_automations.step_enabled')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {seq.steps.map((step) => (
                      <tr key={step.id} className={settingsTrClass}>
                        <td className={settingsTdClass}>
                          <Input
                            type="number"
                            min={0}
                            defaultValue={step.day_offset}
                            onBlur={(e) => {
                              const v = Math.max(0, Number(e.target.value) || 0);
                              if (v !== step.day_offset) {
                                updateStep.mutate({ id: step.id, day_offset: v });
                              }
                            }}
                            className="h-8 w-20 text-xs"
                          />
                        </td>
                        <td className={settingsTdClass}>
                          <div className="text-xs">
                            {templateByKey.get(step.template_key)?.subject ?? step.template_key}
                          </div>
                          <code className="text-[10px] text-muted-foreground">{step.template_key}</code>
                        </td>
                        <td className={`${settingsTdClass} text-right`}>
                          <Toggle
                            checked={step.enabled}
                            onChange={(v) => updateStep.mutate({ id: step.id, enabled: v })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SettingsTableShell>
            </SettingsCard>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t('email_automations.templates')}</h2>
        <div className="space-y-2">
          {templates.map((tpl) => (
            <TemplateEditor key={tpl.key} tpl={tpl} />
          ))}
        </div>
      </section>
    </div>
  );
}
