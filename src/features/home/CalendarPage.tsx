import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/layout/page-shell';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';
import { useScheduledLeads, type ScheduledLead } from './hooks/useScheduledLeads';
import { useUserTasks, type UserTaskRow } from './hooks/useUserTasks';
import { useToggleTaskComplete } from './hooks/useDeleteTask';
import { TaskDialog } from './TaskDialog';

type View = 'day' | 'week';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function rangeFor(view: View, cursor: Date): { start: Date; end: Date } {
  if (view === 'day') return { start: startOfDay(cursor), end: addDays(endOfDay(cursor), 0) };
  return { start: startOfWeek(cursor), end: addDays(startOfWeek(cursor), 7) };
}

function leadName(l: ScheduledLead): string {
  const contact = [l.contact_first_name, l.contact_last_name].filter(Boolean).join(' ').trim();
  return contact || l.company_name || l.title || '—';
}

function leadHeadline(l: ScheduledLead): string {
  if (l.stage?.code === 'offer_sent' || l.stage?.code === 'ud_offer_sent') {
    return `Offer sent follow up · ${leadName(l)}`;
  }
  return leadName(l);
}

function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

type CalendarEntry =
  | { kind: 'lead'; lead: ScheduledLead; date: string }
  | { kind: 'task'; task: UserTaskRow; date: string };

function mergeEntries(leads: ScheduledLead[], tasks: UserTaskRow[]): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const l of leads) out.push({ kind: 'lead', lead: l, date: l.scheduled_for });
  for (const t of tasks) out.push({ kind: 'task', task: t, date: t.due_at });
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

type ViewProps = {
  cursor: Date;
  entries: CalendarEntry[];
  locale: string;
  onEditTask: (task: UserTaskRow) => void;
};

function TaskRow({
  task,
  locale,
  onEdit,
  layout,
}: {
  task: UserTaskRow;
  locale: string;
  onEdit: (t: UserTaskRow) => void;
  layout: 'day' | 'week';
}) {
  const toggle = useToggleTaskComplete();
  const done = !!task.completed_at;
  const className =
    layout === 'day'
      ? cn(
          'flex items-center gap-3 rounded-lg border border-amber-200/60 bg-amber-50/50 px-3 py-2.5 transition-colors hover:bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/30',
          done && 'opacity-60',
        )
      : cn(
          'flex items-start gap-1.5 rounded-md border border-amber-200/60 bg-amber-50/70 px-2 py-1.5 text-amber-950 transition-colors hover:bg-amber-100/80 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/50',
          done && 'opacity-60',
        );
  return (
    <div className={className}>
      <input
        type="checkbox"
        className="mt-0.5 size-3.5 shrink-0 accent-amber-600"
        checked={done}
        onChange={(e) => {
          e.stopPropagation();
          toggle.mutate({ id: task.id, completed: e.target.checked });
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label="Toggle complete"
      />
      {layout === 'day' && (
        <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
          {formatTime(task.due_at, locale)}
        </span>
      )}
      <button
        type="button"
        onClick={() => onEdit(task)}
        className={cn(
          'min-w-0 flex-1 text-left',
          layout === 'day' ? 'text-sm font-medium' : 'text-xs',
          done && 'line-through',
        )}
      >
        {layout === 'week' && (
          <span className="mr-1 font-mono text-[10px] opacity-70">
            {formatTime(task.due_at, locale)}
          </span>
        )}
        {task.title}
      </button>
    </div>
  );
}

function DayView({ cursor, entries, locale, onEditTask }: ViewProps) {
  const { t } = useTranslation('home');
  const todayEntries = entries.filter((e) => sameDay(new Date(e.date), cursor));
  if (todayEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
        <p className="text-sm font-medium text-foreground">{t('calendar.empty_day')}</p>
        <p className="mt-1 text-xs text-muted-foreground">Nothing scheduled for this day.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {todayEntries.map((e) =>
        e.kind === 'lead' ? (
          <li
            key={`lead-${e.lead.id}`}
            className="flex items-center gap-3 rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10"
          >
            <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
              {formatTime(e.lead.scheduled_for, locale)}
            </span>
            <Link
              to={`/leads/${e.lead.id}`}
              className="min-w-0 flex-1 truncate text-sm font-medium text-primary hover:underline"
            >
              {leadHeadline(e.lead)}
            </Link>
            {e.lead.code && (
              <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {e.lead.code}
              </span>
            )}
          </li>
        ) : (
          <li key={`task-${e.task.id}`}>
            <TaskRow task={e.task} locale={locale} onEdit={onEditTask} layout="day" />
          </li>
        ),
      )}
    </ul>
  );
}

function WeekView({ cursor, entries, locale, onEditTask }: ViewProps) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = new Map<string, CalendarEntry[]>();
  for (const d of days) byDay.set(d.toDateString(), []);
  for (const e of entries) {
    const k = new Date(e.date).toDateString();
    byDay.get(k)?.push(e);
  }
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' });
  return (
    <div className="grid min-h-[14rem] grid-cols-7 gap-2">
      {days.map((d) => {
        const list = byDay.get(d.toDateString()) ?? [];
        const isToday = sameDay(d, new Date());
        return (
          <div
            key={d.toDateString()}
            className={cn(
              'flex min-h-[12rem] flex-col overflow-hidden rounded-xl border bg-card shadow-sm',
              isToday ? 'border-primary/30 ring-1 ring-primary/10' : 'border-border/60',
            )}
          >
            <div
              className={cn(
                'border-b px-2.5 py-2 text-xs font-semibold',
                isToday
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-border/60 bg-muted/30 text-muted-foreground',
              )}
            >
              {weekdayFmt.format(d)}
            </div>
            <ul className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
              {list.length === 0 ? (
                <li className="flex flex-1 items-center justify-center px-1 py-4 text-[10px] text-muted-foreground/50">
                  —
                </li>
              ) : (
                list.map((e) =>
                  e.kind === 'lead' ? (
                    <li key={`lead-${e.lead.id}`}>
                      <Link
                        to={`/leads/${e.lead.id}`}
                        className="block rounded-md border border-primary/15 bg-primary/5 px-2 py-1.5 text-primary transition-colors hover:bg-primary/10"
                      >
                        <span className="block font-mono text-[10px] opacity-70">
                          {formatTime(e.lead.scheduled_for, locale)}
                        </span>
                        <span className="line-clamp-2 text-xs font-medium leading-snug">
                          {leadHeadline(e.lead)}
                        </span>
                      </Link>
                    </li>
                  ) : (
                    <li key={`task-${e.task.id}`}>
                      <TaskRow task={e.task} locale={locale} onEdit={onEditTask} layout="week" />
                    </li>
                  ),
                )
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function CalendarPage() {
  const { t, i18n } = useTranslation('home');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? '');

  const [view, setView] = useState<View>('week');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [showAllAdmin, setShowAllAdmin] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<UserTaskRow | null>(null);

  const { start, end } = useMemo(() => rangeFor(view, cursor), [view, cursor]);
  const ownerUserId = isAdmin && showAllAdmin ? null : userId || null;

  const { data: leads = [] } = useScheduledLeads({ start, end, ownerUserId });
  const { data: tasks = [] } = useUserTasks({ start, end, ownerUserId });
  const entries = useMemo(() => mergeEntries(leads, tasks), [leads, tasks]);

  function shift(delta: number) {
    if (view === 'day') setCursor((c) => addDays(c, delta));
    else setCursor((c) => addDays(c, delta * 7));
  }

  function openNewTask() {
    setEditingTask(null);
    setDialogOpen(true);
  }
  function openEditTask(task: UserTaskRow) {
    setEditingTask(task);
    setDialogOpen(true);
  }

  const periodLabel = useMemo(() => {
    if (view === 'day') {
      return new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(cursor);
    }
    const s = startOfWeek(cursor);
    const e = addDays(s, 6);
    const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    return `${fmt.format(s)} – ${fmt.format(e)}`;
  }, [view, cursor, locale]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">{t('calendar.title')}</h1>
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setCursor(new Date())}>
              {t('calendar.today')}
            </Button>
            <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => shift(1)}>
              <ChevronRight className="size-4" />
            </Button>
            <span className="ml-1 text-sm font-medium text-muted-foreground">{periodLabel}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openNewTask}>
            <Plus className="size-3.5" />
            {t('calendar.new_task')}
          </Button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAllAdmin((v) => !v)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                showAllAdmin
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground',
              )}
            >
              {showAllAdmin ? t('calendar.all_team') : t('calendar.my_calendar')}
            </button>
          )}
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as View)}
            options={[
              { value: 'day', label: t('calendar.view.day') },
              { value: 'week', label: t('calendar.view.week') },
            ]}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'day' && (
          <DayView cursor={cursor} entries={entries} locale={locale} onEditTask={openEditTask} />
        )}
        {view === 'week' && (
          <WeekView cursor={cursor} entries={entries} locale={locale} onEditTask={openEditTask} />
        )}
      </div>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        defaultDueAt={view === 'day' ? cursor : null}
      />
    </div>
  );
}
