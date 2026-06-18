import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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

  return (
    <SettingsCard className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/35"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{tpl.subject}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {tpl.description} · <code className="text-[10px]">{tpl.key}</code>
          </div>
        </div>
        <span className="ml-3 shrink-0 text-xs text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/60 p-4">
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
              rows={9}
              className="mt-1.5 block w-full rounded-lg border border-input/80 bg-background px-3 py-2 font-mono text-xs shadow-sm focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
            />
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
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty}
              onClick={() => {
                setSubject(tpl.subject);
                setBody(tpl.body);
              }}
            >
              {t('email_automations.reset')}
            </Button>
            <Button
              size="sm"
              disabled={!dirty || update.isPending}
              onClick={() => update.mutate({ key: tpl.key, subject, body })}
            >
              {t('email_automations.save')}
            </Button>
          </div>
        </div>
      )}
    </SettingsCard>
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

  const globalRow = settings.find((s) => s.key === 'global');
  const oneShots = settings.filter((s) => s.key !== 'global');
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
