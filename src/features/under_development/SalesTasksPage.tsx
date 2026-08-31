import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarClock, Pause, Phone, PhoneIncoming, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CallLink } from '@/components/CallLink';
import { FilterSelect, PageHeader } from '@/components/layout/page-shell';
import { useAuthStore } from '@/lib/stores/authStore';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { stageAccent } from '@/lib/stage-colors';
import { cn } from '@/lib/utils';
import { CadenceFinalMoveDialog, CadenceOutcomeButtons } from './CadenceOutcomeButtons';
import { CadenceSnoozeButton } from './CadenceSnoozeButton';
import { useSetRunPaused } from './hooks/useLeadCadence';
import {
  useCadenceOverview,
  type CadenceDecision,
  type CadenceOpenTask,
} from './hooks/useCadenceOverview';
import { useUpcomingMeetings, type MeetingLead } from './hooks/useUpcomingMeetings';

type Group = 'meetings' | 'decision' | 'overdue' | 'today' | 'upcoming';
const GROUP_ORDER: Group[] = ['meetings', 'decision', 'overdue', 'today', 'upcoming'];

function groupOf(dueIso: string): Exclude<Group, 'decision' | 'meetings'> {
  const due = new Date(dueIso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  if (due < startOfToday) return 'overdue';
  if (due < startOfTomorrow) return 'today';
  return 'upcoming';
}

const GROUP_TONE: Record<Group, { chip: string; header: string }> = {
  meetings: {
    chip: 'border-blue-500/50 text-blue-700 dark:text-blue-300',
    header: 'text-blue-600 dark:text-blue-400',
  },
  decision: {
    chip: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
    header: 'text-amber-600 dark:text-amber-400',
  },
  overdue: {
    chip: 'border-red-500/50 text-red-700 dark:text-red-400',
    header: 'text-red-600 dark:text-red-400',
  },
  today: {
    chip: 'border-[#1a9696]/50 text-[#157777] dark:text-[#7ad4d4]',
    header: 'text-[#157777] dark:text-[#7ad4d4]',
  },
  upcoming: {
    chip: 'border-border text-muted-foreground',
    header: 'text-muted-foreground',
  },
};

/**
 * The reps' call sheet for the Under Development pipeline: one dense, aligned
 * queue — read top to bottom, phone, click an outcome, next row. Cadence
 * tasks live only here; the general Tasks board excludes them.
 */
export function SalesTasksPage() {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const locale = lang === 'el' ? 'el-GR' : 'en-US';
  const navigate = useNavigate();
  const meId = useAuthStore((s) => s.user?.id ?? null);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { overview, isLoading } = useCadenceOverview();
  const { data: meetingLeads = [] } = useUpcomingMeetings();
  const { data: owners = [] } = useAssignableOwners();
  const { data: stages = [] } = usePipelineStages();
  const [ownerFilter, setOwnerFilter] = useState<string | 'all'>(isAdmin ? 'all' : meId ?? 'all');
  const [groupFilter, setGroupFilter] = useState<Group | null>(null);
  const [finalMove, setFinalMove] = useState<{ leadId: string; stageId: string } | null>(null);
  const setPaused = useSetRunPaused();

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const nameFor = (id: string | null) =>
    id ? (owners.find((o) => o.user_id === id)?.full_name ?? '') : '';
  const showOwnerCol = isAdmin && ownerFilter === 'all';

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const fmtDue = (iso: string) => {
    const d = new Date(iso);
    return d >= startOfToday && d.getDate() === now.getDate()
      ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d)
      : new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(d);
  };

  const matchesOwner = (userId: string | null) => ownerFilter === 'all' || userId === ownerFilter;
  const tasks = overview.openTasks.filter((task) => matchesOwner(task.user_id));
  const decisions = overview.needsDecision.filter((d) => matchesOwner(d.lead.owner_user_id));
  const meetings = meetingLeads.filter((m) => matchesOwner(m.owner_user_id));
  const grouped: Record<Exclude<Group, 'decision' | 'meetings'>, CadenceOpenTask[]> = {
    overdue: [],
    today: [],
    upcoming: [],
  };
  for (const task of tasks) grouped[groupOf(task.due_at)].push(task);
  const countOf: Record<Group, number> = {
    meetings: meetings.length,
    decision: decisions.length,
    overdue: grouped.overdue.length,
    today: grouped.today.length,
    upcoming: grouped.upcoming.length,
  };

  function stageChip(stageId: string | null) {
    const stage = stageId ? stageById.get(stageId) : undefined;
    if (!stage) return null;
    const accent = stageAccent(stage.code.replace(/^ud_/, ''), 0);
    return (
      <span className={cn('truncate rounded-full px-2 py-0.5 text-[10px] font-semibold', accent.badge)}>
        {(stage.display_names as { en: string; el: string })[lang]}
      </span>
    );
  }

  // One aligned grid shared by every row so the sheet reads in columns.
  const rowGrid = cn(
    'grid grid-cols-[3.2rem_minmax(0,1.15fr)_minmax(0,1.5fr)_8.5rem] items-center gap-x-3',
    showOwnerCol
      ? 'lg:grid-cols-[3.2rem_minmax(0,1.1fr)_minmax(0,1.5fr)_8.5rem_6.5rem_6.5rem_max-content]'
      : 'lg:grid-cols-[3.2rem_minmax(0,1.1fr)_minmax(0,1.5fr)_8.5rem_6.5rem_max-content]',
  );

  const openLead = (leadId: string) => navigate(`/leads/${leadId}`);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const leadCell = (lead: { id: string; code: string | null; title: string; company_name: string | null }) => (
    <span className="flex min-w-0 items-baseline gap-1.5">
      {lead.code && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{lead.code}</span>
      )}
      <Link
        to={`/leads/${lead.id}`}
        onClick={stop}
        className="truncate text-sm font-medium hover:text-[#157777] hover:underline dark:hover:text-[#7ad4d4]"
      >
        {lead.title}
      </Link>
      {lead.company_name && (
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          · {lead.company_name}
        </span>
      )}
    </span>
  );

  const taskRow = (task: CadenceOpenTask, group: Group) => {
    const lead = task.lead!;
    const step = task.cadence_step_id ? overview.stepLabelById.get(task.cadence_step_id) : null;
    return (
      <li
        key={task.id}
        onClick={() => openLead(lead.id)}
        className={cn(rowGrid, 'cursor-pointer px-3 py-2 transition-colors hover:bg-muted/50')}
      >
        <span
          className={cn(
            'text-xs tabular-nums',
            group === 'overdue' ? 'font-bold text-red-600 dark:text-red-400' : 'text-muted-foreground',
          )}
        >
          {fmtDue(task.due_at)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{task.title}</span>
          {step && (
            <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
              {step}
            </span>
          )}
        </span>
        {leadCell(lead)}
        <span className="flex items-center gap-1 text-xs" onClick={stop}>
          {lead.phone ? (
            <>
              <Phone className="size-3 shrink-0 text-[#1a9696]" />
              <CallLink phone={lead.phone} />
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {overview.lastCallByLead.has(lead.id) && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
              title={t('ud.tasks.last_call_hint')}
            >
              <PhoneIncoming className="size-3" />
              {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
                new Date(overview.lastCallByLead.get(lead.id)!),
              )}
            </span>
          )}
        </span>
        <span className="hidden lg:flex">{stageChip(lead.stage_id)}</span>
        {showOwnerCol && (
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">
            {nameFor(task.user_id).split(' ')[0]}
          </span>
        )}
        <span
          className="col-span-full mt-1.5 flex items-center justify-end gap-1 lg:col-span-1 lg:mt-0"
          onClick={stop}
        >
          {overview.pausedLeads.has(lead.id) ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                <Pause className="size-3" />
                {t('ud.cadence.status.paused')}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={setPaused.isPending}
                onClick={() => setPaused.mutate({ leadId: lead.id, paused: false })}
              >
                <Play className="size-3.5" />
                {t('ud.cadence.resume')}
              </Button>
            </>
          ) : (
            <>
              <CadenceSnoozeButton taskId={task.id} />
              <CadenceOutcomeButtons
                taskId={task.id}
                leadId={lead.id}
                onExhausted={(stageId) => setFinalMove({ leadId: lead.id, stageId })}
              />
            </>
          )}
        </span>
      </li>
    );
  };

  const decisionRow = (d: CadenceDecision) => (
    <li
      key={d.runId}
      onClick={() => openLead(d.lead.id)}
      className={cn(rowGrid, 'cursor-pointer px-3 py-2 transition-colors hover:bg-muted/50')}
    >
      <span>
        <AlertTriangle className="size-4 text-amber-500" />
      </span>
      <span className="truncate text-xs text-amber-700 dark:text-amber-300">
        {d.reason === 'exhausted' ? t('ud.tasks.decision_exhausted') : t('ud.tasks.decision_reached')}
      </span>
      {leadCell(d.lead)}
      <span className="flex items-center gap-1 text-xs" onClick={stop}>
        {d.lead.phone ? (
          <>
            <Phone className="size-3 shrink-0 text-[#1a9696]" />
            <CallLink phone={d.lead.phone} />
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
      <span className="hidden lg:flex">{stageChip(d.lead.stage_id)}</span>
      {showOwnerCol && (
        <span className="hidden truncate text-xs text-muted-foreground lg:inline">
          {nameFor(d.lead.owner_user_id).split(' ')[0]}
        </span>
      )}
      <span className="col-span-full mt-1.5 flex justify-end lg:col-span-1 lg:mt-0" onClick={stop}>
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
          <Button asChild size="sm" variant="outline" onClick={stop}>
            <Link to={`/leads/${d.lead.id}`}>{t('ud.tasks.open_lead')}</Link>
          </Button>
        )}
      </span>
    </li>
  );

  const fmtMeeting = (iso: string) => {
    const d = new Date(iso);
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
    const isToday = d >= startOfToday && d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
    return isToday
      ? time
      : `${new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(d)} ${time}`;
  };

  const meetingRow = (m: MeetingLead) => {
    const passed = new Date(m.scheduled_for) < now;
    return (
      <li
        key={m.id}
        onClick={() => openLead(m.id)}
        className={cn(rowGrid, 'cursor-pointer px-3 py-2 transition-colors hover:bg-muted/50')}
      >
        <span
          className={cn(
            'text-xs tabular-nums font-semibold',
            passed ? 'text-red-600 dark:text-red-400' : 'text-blue-700 dark:text-blue-300',
          )}
        >
          {fmtMeeting(m.scheduled_for)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <CalendarClock
            className={cn('size-4 shrink-0', passed ? 'text-red-500' : 'text-blue-500')}
          />
          <span className="truncate text-sm font-semibold">
            {passed ? t('ud.tasks.meeting_passed') : t('ud.tasks.meeting_label')}
          </span>
        </span>
        {leadCell(m)}
        <span className="flex items-center gap-1 text-xs" onClick={stop}>
          {m.phone ? (
            <>
              <Phone className="size-3 shrink-0 text-[#1a9696]" />
              <CallLink phone={m.phone} />
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
        <span className="hidden lg:flex">{stageChip(m.stage_id)}</span>
        {showOwnerCol && (
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">
            {nameFor(m.owner_user_id).split(' ')[0]}
          </span>
        )}
        <span className="col-span-full mt-1.5 flex justify-end lg:col-span-1 lg:mt-0" onClick={stop}>
          <Button asChild size="sm" variant="outline" onClick={stop}>
            <Link to={`/leads/${m.id}`}>{t('ud.tasks.open_lead')}</Link>
          </Button>
        </span>
      </li>
    );
  };

  const visibleGroups = GROUP_ORDER.filter(
    (g) => (groupFilter ? g === groupFilter : true) && countOf[g] > 0,
  );

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('ud.tasks.title')}>
        {/* Group chips double as counters and filters — no vertical space lost. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {GROUP_ORDER.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupFilter((cur) => (cur === g ? null : g))}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                GROUP_TONE[g].chip,
                groupFilter === g ? 'bg-muted font-semibold' : 'hover:bg-muted/60',
                countOf[g] === 0 && 'opacity-40',
              )}
            >
              {t(`ud.tasks.group_${g}`)} · {countOf[g]}
            </button>
          ))}
          {isAdmin && (
            <FilterSelect
              value={ownerFilter === 'all' ? '' : ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value || 'all')}
              className="ml-2"
            >
              <option value="">{t('filters.all')}</option>
              {owners.map((o) => (
                <option key={o.user_id} value={o.user_id}>
                  {o.full_name || o.email}
                </option>
              ))}
            </FilterSelect>
          )}
        </div>
      </PageHeader>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : visibleGroups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
          {t('ud.tasks.all_clear')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
          {visibleGroups.map((g) => (
            <section key={g}>
              <h2
                className={cn(
                  'border-b border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide',
                  GROUP_TONE[g].header,
                )}
              >
                {t(`ud.tasks.group_${g}`)} ({countOf[g]})
              </h2>
              <ul className="divide-y divide-border/40 border-b border-border/60 last:border-b-0">
                {g === 'meetings'
                  ? meetings.map(meetingRow)
                  : g === 'decision'
                    ? decisions.map(decisionRow)
                    : grouped[g].map((task) => taskRow(task, g))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <CadenceFinalMoveDialog
        leadId={finalMove?.leadId ?? ''}
        stageId={finalMove?.stageId ?? null}
        onClose={() => setFinalMove(null)}
      />
    </div>
  );
}
