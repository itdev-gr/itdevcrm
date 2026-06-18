import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
    <div className="rounded border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted"
      >
        <div>
          <div className="text-sm font-medium">{tpl.subject}</div>
          <div className="text-xs text-muted-foreground">
            {tpl.description} · <code className="text-[10px]">{tpl.key}</code>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t p-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {t('email_automations.subject')}
            </label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {t('email_automations.body')}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
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
    </div>
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
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('email_automations.title')}</h1>
        {globalRow && (
          <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
            <Toggle
              checked={globalRow.enabled}
              onChange={(v) => updateSetting.mutate({ key: 'global', enabled: v })}
            />
            <span className={globalRow.enabled ? 'font-medium' : 'font-medium text-red-600 dark:text-red-400'}>
              {t('email_automations.global_switch')}
            </span>
          </label>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">
          {t('email_automations.one_shots')}
        </h2>
        <div className="divide-y rounded border">
          {oneShots.map((s) => (
            <label key={s.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm">{s.description}</span>
              <Toggle
                checked={s.enabled}
                onChange={(v) => updateSetting.mutate({ key: s.key, enabled: v })}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">
          {t('email_automations.sequences')}
        </h2>
        {sequences.map((seq) => (
          <div key={seq.id} className="rounded border">
            <div className="flex items-center justify-between border-b bg-muted px-3 py-2">
              <div>
                <div className="text-sm font-medium">{seq.display_name}</div>
                <div className="text-xs text-muted-foreground">{seq.description}</div>
              </div>
              <Toggle
                checked={seq.enabled}
                onChange={(v) => updateSequence.mutate({ id: seq.id, enabled: v })}
              />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">{t('email_automations.step_day')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('email_automations.step_email')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">
                    {t('email_automations.step_enabled')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {seq.steps.map((step) => (
                  <tr key={step.id} className="border-t">
                    <td className="px-3 py-1.5">
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
                    <td className="px-3 py-1.5 text-xs">
                      {templateByKey.get(step.template_key)?.subject ?? step.template_key}
                      <code className="ml-2 text-[10px] text-muted-foreground">{step.template_key}</code>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Toggle
                        checked={step.enabled}
                        onChange={(v) => updateStep.mutate({ id: step.id, enabled: v })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">
          {t('email_automations.templates')}
        </h2>
        <div className="space-y-2">
          {templates.map((tpl) => (
            <TemplateEditor key={tpl.key} tpl={tpl} />
          ))}
        </div>
      </section>
    </div>
  );
}
