import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CallLink } from '@/components/CallLink';
import { CopyableCode } from '@/components/CopyableCode';
import { FilterBar, FilterSelect, PageHeader, SegmentedControl } from '@/components/layout/page-shell';
import { useAuthStore } from '@/lib/stores/authStore';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { stageAccent } from '@/lib/stage-colors';
import { cn } from '@/lib/utils';
import { CadenceFinalMoveDialog, CadenceOutcomeButtons } from './CadenceOutcomeButtons';
import {
  useCadenceOverview,
  type CadenceDecision,
  type CadenceOpenTask,
} from './hooks/useCadenceOverview';

type Group = 'overdue' | 'today' | 'upcoming';

function groupOf(dueIso: string): Group {
  const due = new Date(dueIso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  if (due < startOfToday) return 'overdue';
  if (due < startOfTomorrow) return 'today';
  return 'upcoming';
}

/**
 * The sales reps' dedicated working surface for the Under Development
 * pipeline: chain tasks grouped by urgency (phone → click → next) plus the
 * leads whose chain ended without a decision. Cadence tasks live ONLY here —
 * the general Tasks board excludes them.
 */
export function SalesTasksPage() {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const locale = lang === 'el' ? 'el-GR' : 'en-US';
  const meId = useAuthStore((s) => s.user?.id ?? null);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { overview, isLoading } = useCadenceOverview();
  const { data: owners = [] } = useAssignableOwners();
  const { data: stages = [] } = usePipelineStages();
  const [ownerFilter, setOwnerFilter] = useState<string | 'all'>(isAdmin ? 'all' : meId ?? 'all');
  const [finalMove, setFinalMove] = useState<{ leadId: string; stageId: string } | null>(null);

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const nameFor = (id: string | null) =>
    id ? (owners.find((o) => o.user_id === id)?.full_name ?? '') : '';

  const fmtDue = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );

  const matchesOwner = (userId: string | null) => ownerFilter === 'all' || userId === ownerFilter;
  const tasks = overview.openTasks.filter((task) => matchesOwner(task.user_id));
  const decisions = overview.needsDecision.filter((d) => matchesOwner(d.lead.owner_user_id));
  const grouped: Record<Group, CadenceOpenTask[]> = { overdue: [], today: [], upcoming: [] };
  for (const task of tasks) grouped[groupOf(task.due_at)].push(task);

  function stageBadge(stageId: string | null) {
    const stage = stageId ? stageById.get(stageId) : undefined;
    if (!stage) return null;
    const accent = stageAccent(stage.code.replace(/^ud_/, ''), 0);
    return (
      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', accent.badge)}>
        {(stage.display_names as { en: string; el: string })[lang]}
      </span>
    );
  }

  const taskRow = (task: CadenceOpenTask, group: Group) => {
    const lead = task.lead!;
    const step = task.cadence_step_id ? overview.stepLabelById.get(task.cadence_step_id) : null;
    return (
      <li
        key={task.id}
        className={cn(
          'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 shadow-sm',
          group === 'overdue' ? 'border-red-500/40' : 'border-border/60',
        )}
      >
        <div className="min-w-0 flex-1 basis-52">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{task.title}</span>
            {step && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t('ud.tasks.step', { step })}
              </span>
            )}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {lead.code && <CopyableCode code={lead.code} className="text-[10px]" />}
            <Link to={`/leads/${lead.id}`} className="truncate font-medium text-foreground hover:text-[#157777] hover:underline dark:hover:text-[#7ad4d4]">
              {lead.title}
            </Link>
            {lead.company_name && <span className="truncate">· {lead.company_name}</span>}
          </p>
        </div>
        {lead.phone && (
          <span className="flex items-center gap-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
            <Phone className="size-3.5 shrink-0 text-[#1a9696]" />
            <CallLink phone={lead.phone} />
          </span>
        )}
        {stageBadge(lead.stage_id)}
        {ownerFilter === 'all' && isAdmin && (
          <span className="text-xs text-muted-foreground">{nameFor(task.user_id)}</span>
        )}
        <span
          className={cn(
            'inline-flex items-center gap-1 text-xs',
            group === 'overdue' ? 'font-semibold text-red-600 dark:text-red-400' : 'text-muted-foreground',
          )}
        >
          <Clock className="size-3.5" />
          {fmtDue(task.due_at)}
        </span>
        <CadenceOutcomeButtons
          taskId={task.id}
          leadId={lead.id}
          onExhausted={(stageId) => setFinalMove({ leadId: lead.id, stageId })}
        />
      </li>
    );
  };

  const decisionRow = (d: CadenceDecision) => (
    <li
      key={d.runId}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-500/40 bg-card px-4 py-3 shadow-sm"
    >
      <AlertTriangle className="size-4 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1 basis-52">
        <p className="flex items-center gap-1.5 text-sm">
          {d.lead.code && <CopyableCode code={d.lead.code} className="text-[10px]" />}
          <Link to={`/leads/${d.lead.id}`} className="truncate font-semibold hover:text-[#157777] hover:underline dark:hover:text-[#7ad4d4]">
            {d.lead.title}
          </Link>
          {d.lead.company_name && (
            <span className="truncate text-muted-foreground">· {d.lead.company_name}</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {d.reason === 'exhausted' ? t('ud.tasks.decision_exhausted') : t('ud.tasks.decision_reached')}
        </p>
      </div>
      {stageBadge(d.lead.stage_id)}
      {ownerFilter === 'all' && isAdmin && (
        <span className="text-xs text-muted-foreground">{nameFor(d.lead.owner_user_id)}</span>
      )}
      {d.reason === 'exhausted' && d.finalMoveStageId ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          onClick={() => setFinalMove({ leadId: d.lead.id, stageId: d.finalMoveStageId! })}
        >
          {t('ud.tasks.move_cta', { stage: d.finalMoveStageLabel?.[lang] ?? '' })}
        </Button>
      ) : (
        <Button asChild size="sm" variant="outline">
          <Link to={`/leads/${d.lead.id}`}>{t('ud.tasks.open_lead')}</Link>
        </Button>
      )}
    </li>
  );

  const section = (group: Group, items: CadenceOpenTask[]) => (
    <section key={group}>
      <h2
        className={cn(
          'mb-2 text-xs font-semibold uppercase tracking-wide',
          group === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
        )}
      >
        {t(`ud.tasks.group_${group}`)} ({items.length})
      </h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-4 py-5 text-center text-xs text-muted-foreground">
          {t('ud.tasks.group_empty')}
        </p>
      ) : (
        <ul className="space-y-2">{items.map((task) => taskRow(task, group))}</ul>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('ud.tasks.title')} />

      {isAdmin && (
        <FilterBar>
          <SegmentedControl
            value={ownerFilter === 'all' ? 'all' : 'mine'}
            onChange={(v) => setOwnerFilter(v === 'all' ? 'all' : meId ?? 'all')}
            options={[
              { value: 'mine', label: t('filters.mine') },
              { value: 'all', label: t('filters.all') },
            ]}
          />
          <FilterSelect
            value={ownerFilter === 'all' ? '' : ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value || 'all')}
          >
            <option value="">{t('filters.all')}</option>
            {owners.map((o) => (
              <option key={o.user_id} value={o.user_id}>
                {o.full_name || o.email}
              </option>
            ))}
          </FilterSelect>
        </FilterBar>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        <>
          {decisions.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                {t('ud.tasks.group_decision')} ({decisions.length})
              </h2>
              <ul className="space-y-2">{decisions.map(decisionRow)}</ul>
            </section>
          )}
          {section('overdue', grouped.overdue)}
          {section('today', grouped.today)}
          {section('upcoming', grouped.upcoming)}
        </>
      )}

      <CadenceFinalMoveDialog
        leadId={finalMove?.leadId ?? ''}
        stageId={finalMove?.stageId ?? null}
        onClose={() => setFinalMove(null)}
      />
    </div>
  );
}
