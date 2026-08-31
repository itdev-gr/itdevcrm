import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, PauseCircle, Phone } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { cn } from '@/lib/utils';
import {
  useUdCadencesAdmin,
  useUdSettings,
  useUdTemplates,
  useUpdateUdCadence,
  useUpdateUdSettings,
  useUpdateUdStep,
} from './hooks/useUdAdmin';
import type { CadenceStepRow } from './hooks/useLeadCadence';

/** One numeric setting that saves on blur/Enter. */
function DaysInput({
  value,
  onSave,
  disabled,
  max,
}: {
  value: number;
  onSave: (v: number) => void;
  disabled?: boolean;
  max?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 0 && (max == null || n <= max) && n !== value) onSave(n);
    setDraft(null);
  };
  return (
    <Input
      type="number"
      min={0}
      max={max}
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="h-8 w-16 text-center text-sm"
    />
  );
}

/**
 * The Sales Automations admin page: every Under Development chain drawn as
 * the flow the owner sketched — task → email → task — with the days, the
 * per-step switches and the escalation/auto-pause settings all in one place.
 * Email copy is edited on the Email automations page (linked per step).
 */
export function SalesAutomationsPage() {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: cadences = [], isLoading } = useUdCadencesAdmin();
  const { data: templates = new Map<string, string>() } = useUdTemplates();
  const { data: settings } = useUdSettings();
  const { data: stages = [] } = usePipelineStages();
  const updateCadence = useUpdateUdCadence();
  const updateStep = useUpdateUdStep();
  const updateSettings = useUpdateUdSettings();

  const stageLabel = (code: string | null) => {
    const s = code
      ? stages.find((x) => x.board === 'under_development' && x.code === code)
      : undefined;
    return s ? (s.display_names as { en: string; el: string })[lang] : '—';
  };

  const stepRow = (step: CadenceStepRow, idx: number) => {
    const title =
      step.kind === 'task'
        ? ((step.titles as { en?: string; el?: string } | null)?.[lang] ??
          (step.titles as { en?: string; el?: string } | null)?.el ??
          '—')
        : (templates.get(step.template_key ?? '') ?? step.template_key ?? '—');
    return (
      <li
        key={step.id}
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2',
          step.enabled ? 'border-border/60' : 'border-dashed border-border/50 opacity-60',
        )}
      >
        <span className="w-5 text-right text-[11px] text-muted-foreground">{idx + 1}.</span>
        {step.kind === 'email' ? (
          <Mail className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Phone className="size-3.5 shrink-0 text-[#1a9696]" />
        )}
        <span className="min-w-0 flex-1 basis-48">
          <span className="block truncate text-sm font-medium">{title}</span>
          {step.kind === 'email' && step.template_key && (
            <Link
              to="/admin/email-automations"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t('ud.admin.edit_copy')}
            </Link>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          +
          <DaysInput
            value={step.delay_days}
            disabled={updateStep.isPending}
            onSave={(v) => updateStep.mutate({ id: step.id, patch: { delay_days: v } })}
          />
          {t('ud.admin.days_after_previous')}
          <DaysInput
            value={step.delay_hours ?? 0}
            disabled={updateStep.isPending}
            max={23}
            onSave={(v) => updateStep.mutate({ id: step.id, patch: { delay_hours: v } })}
          />
          {t('ud.admin.hours_after_previous')}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={step.enabled}
            onCheckedChange={(v) =>
              updateStep.mutate({ id: step.id, patch: { enabled: v === true } })
            }
          />
          {t('ud.admin.enabled')}
        </label>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">{t('ud.admin.settings_title')}</h2>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">{t('ud.admin.overdue_rep')}</Label>
            <div className="mt-1">
              <DaysInput
                value={settings?.overdue_rep_days ?? 1}
                disabled={!settings || updateSettings.isPending}
                onSave={(v) => updateSettings.mutate({ overdue_rep_days: v })}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t('ud.admin.overdue_admin')}</Label>
            <div className="mt-1">
              <DaysInput
                value={settings?.overdue_admin_days ?? 3}
                disabled={!settings || updateSettings.isPending}
                onSave={(v) => updateSettings.mutate({ overdue_admin_days: v })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 pb-1 text-sm">
            <Checkbox
              checked={settings?.auto_pause_enabled ?? true}
              disabled={!settings || updateSettings.isPending}
              onCheckedChange={(v) => updateSettings.mutate({ auto_pause_enabled: v === true })}
            />
            <span className="inline-flex items-center gap-1.5">
              <PauseCircle className="size-4 text-amber-500" />
              {t('ud.admin.auto_pause')}
            </span>
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('ud.admin.auto_pause_hint')}</p>
      </section>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        cadences.map((c) => (
          <section key={c.id} className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold">
                {(c.display_names as { en: string; el: string })[lang]}
              </h2>
              <span className="text-xs text-muted-foreground">
                {t('ud.admin.starts_on')}{' '}
                <span className="font-medium text-foreground">{stageLabel(c.start_stage_code)}</span>
                {c.final_move_stage_code && (
                  <>
                    {' '}
                    · {t('ud.admin.ends_suggesting')}{' '}
                    <span className="font-medium text-foreground">
                      {stageLabel(c.final_move_stage_code)}
                    </span>
                  </>
                )}
              </span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={c.enabled}
                  onCheckedChange={(v) => updateCadence.mutate({ id: c.id, enabled: v === true })}
                />
                {t('ud.admin.enabled')}
              </label>
            </header>
            <ul className="space-y-1.5">{c.steps.map((s, i) => stepRow(s, i))}</ul>
          </section>
        ))
      )}
    </div>
  );
}
