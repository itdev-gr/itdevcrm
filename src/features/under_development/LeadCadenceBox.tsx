import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clock, Mail, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLeadCadence, type CadenceStepRow } from './hooks/useLeadCadence';
import { CadenceFinalMoveDialog, CadenceOutcomeButtons } from './CadenceOutcomeButtons';

const STATUS_TONE: Record<string, string> = {
  active: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
  paused: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
  completed: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  stopped_reached: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  stopped_stage_change: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  stopped_manual: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

/**
 * The lead's automation chain (Under Development board): every step with its
 * state, the open task with its outcome buttons, and what the chain will do
 * next. Renders nothing for leads that never entered a chain.
 */
export function LeadCadenceBox({ leadId }: { leadId: string }) {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const locale = lang === 'el' ? 'el-GR' : 'en-US';
  const { data, isLoading } = useLeadCadence(leadId);
  // Hosted HERE (not in the buttons) so the confirm survives the open-task row
  // unmounting when the final task completes and the query refetches.
  const [finalMove, setFinalMove] = useState<string | null>(null);

  if (isLoading || !data) return null;
  const { run, cadence, steps, tasks } = data;

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );
  const label = (s: CadenceStepRow) =>
    s.kind === 'task'
      ? ((s.titles as { en: string; el: string } | null)?.[lang] ?? t('ud.cadence.task_step'))
      : t('ud.cadence.email_step');

  const openTask = tasks.find((task) => task.completed_at == null) ?? null;
  const taskByStep = new Map(tasks.map((task) => [task.cadence_step_id, task]));

  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t('ud.cadence.title')} — {(cadence.display_names as { en: string; el: string })[lang]}
        </h2>
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold',
            STATUS_TONE[run.status] ?? STATUS_TONE['completed'],
          )}
        >
          {t(`ud.cadence.status.${run.status}`)}
        </span>
      </header>

      <ol className="space-y-1.5">
        {steps
          .filter((s) => s.enabled)
          .map((s) => {
            const done = s.position <= run.current_position;
            const stepTask = taskByStep.get(s.id);
            const isOpen = openTask != null && stepTask?.id === openTask.id;
            const isPendingEmail =
              s.kind === 'email' &&
              !done &&
              run.status === 'active' &&
              run.next_event_at != null &&
              steps.filter((x) => x.enabled && x.position > run.current_position)[0]?.id === s.id;
            return (
              <li
                key={s.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                  isOpen
                    ? 'border-[#1a9696]/40 bg-[#1a9696]/5'
                    : done
                      ? 'border-border/40 text-muted-foreground'
                      : 'border-dashed border-border/60 text-muted-foreground',
                )}
              >
                {s.kind === 'email' ? (
                  <Mail className="size-3.5 shrink-0 opacity-70" />
                ) : (
                  <Phone className="size-3.5 shrink-0 opacity-70" />
                )}
                <span className={cn('truncate', isOpen && 'font-medium text-foreground')}>{label(s)}</span>
                {stepTask?.cadence_outcome === 'reached' && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-300">
                    {t('ud.cadence.outcome_reached')}
                  </span>
                )}
                {stepTask?.cadence_outcome === 'no_answer' && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-300">
                    {t('ud.cadence.outcome_no_answer')}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
                  {done && !isOpen && <Check className="size-3.5 text-emerald-500" />}
                  {isOpen && openTask?.due_at && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="size-3" />
                      {fmt(openTask.due_at)}
                    </span>
                  )}
                  {isPendingEmail && run.next_event_at && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="size-3" />
                      {fmt(run.next_event_at)}
                    </span>
                  )}
                  {!done && !isOpen && !isPendingEmail && s.delay_days > 0 && (
                    <span className="text-muted-foreground">+{s.delay_days}{t('ud.cadence.days_suffix')}</span>
                  )}
                </span>
              </li>
            );
          })}
      </ol>

      {openTask && run.status === 'active' && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#1a9696]/30 bg-[#1a9696]/5 px-3 py-2.5">
          <span className="text-sm font-medium">{openTask.title}</span>
          <CadenceOutcomeButtons taskId={openTask.id} leadId={leadId} onExhausted={setFinalMove} />
        </div>
      )}

      <CadenceFinalMoveDialog leadId={leadId} stageId={finalMove} onClose={() => setFinalMove(null)} />

      {run.status === 'stopped_reached' && (
        <p className="mt-3 text-xs text-muted-foreground">{t('ud.cadence.note_reached')}</p>
      )}
      {run.status === 'completed' && run.exhausted_at && (
        <p className="mt-3 text-xs text-muted-foreground">{t('ud.cadence.note_exhausted')}</p>
      )}
    </section>
  );
}
