import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEffectiveIsAdmin, useEffectiveUserId } from '@/lib/viewAs';
import { useScheduledLeads, type ScheduledLead } from './hooks/useScheduledLeads';
import { useUserTasks, type UserTaskRow } from './hooks/useUserTasks';
import { useToggleTaskComplete } from './hooks/useDeleteTask';
import { TaskDialog } from './TaskDialog';

type View = 'day' | 'week';

// ── date helpers (no library) ────────────────────────────────────────────────

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
  // Monday as week start.
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
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
  if (l.stage?.code === 'offer_sent') {
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

// ── unified calendar entry ───────────────────────────────────────────────────

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

// ── views ────────────────────────────────────────────────────────────────────

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
      ? `flex items-center gap-3 px-4 py-3 hover:bg-slate-50 ${done ? 'opacity-60' : ''}`
      : `flex items-start gap-1.5 rounded bg-amber-50 px-1.5 py-1 text-amber-900 hover:bg-amber-100 ${done ? 'opacity-60' : ''}`;
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
        <span className="w-16 shrink-0 font-mono text-xs text-slate-600">
          {formatTime(task.due_at, locale)}
        </span>
      )}
      <button
        type="button"
        onClick={() => onEdit(task)}
        className={`min-w-0 flex-1 text-left ${
          layout === 'day' ? 'text-sm font-medium' : 'text-xs'
        } ${done ? 'line-through' : ''}`}
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
      <div className="rounded-md border bg-slate-50 p-6 text-center text-sm text-slate-500">
        {t('calendar.empty_day')}
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {todayEntries.map((e) =>
        e.kind === 'lead' ? (
          <li
            key={`lead-${e.lead.id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
          >
            <span className="w-16 shrink-0 font-mono text-xs text-slate-600">
              {formatTime(e.lead.scheduled_for, locale)}
            </span>
            <Link
              to={`/leads/${e.lead.id}`}
              className="min-w-0 flex-1 truncate text-sm font-medium text-blue-700 hover:underline"
            >
              {leadHeadline(e.lead)}
            </Link>
            {e.lead.code && <span className="text-[10px] text-slate-400">{e.lead.code}</span>}
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
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const list = byDay.get(d.toDateString()) ?? [];
        const isToday = sameDay(d, new Date());
        return (
          <div
            key={d.toDateString()}
            className="flex min-h-[10rem] flex-col rounded-md border bg-white"
          >
            <div
              className={`border-b px-2 py-1 text-xs font-medium ${
                isToday ? 'bg-blue-50 text-blue-800' : 'bg-slate-50 text-slate-600'
              }`}
            >
              {weekdayFmt.format(d)}
            </div>
            <ul className="flex-1 space-y-1 p-2 text-xs">
              {list.length === 0 ? (
                <li className="text-slate-300">·</li>
              ) : (
                list.map((e) =>
                  e.kind === 'lead' ? (
                    <li key={`lead-${e.lead.id}`}>
                      <Link
                        to={`/leads/${e.lead.id}`}
                        className="block rounded bg-blue-50 px-1.5 py-1 text-blue-800 hover:bg-blue-100"
                      >
                        <span className="font-mono text-[10px] opacity-70">
                          {formatTime(e.lead.scheduled_for, locale)}
                        </span>{' '}
                        <span className="truncate">{leadHeadline(e.lead)}</span>
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

// ── shell ────────────────────────────────────────────────────────────────────

export function CalendarPage() {
  const { t, i18n } = useTranslation('home');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const isAdmin = useEffectiveIsAdmin();
  const userId = useEffectiveUserId() ?? '';

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
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{t('calendar.title')}</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setCursor(new Date())}
              className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
            >
              {t('calendar.today')}
            </button>
            <button
              type="button"
              onClick={() => shift(1)}
              className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
            >
              ›
            </button>
            <span className="ml-2 text-sm font-medium text-slate-700">{periodLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openNewTask}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            {t('calendar.new_task')}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAllAdmin((v) => !v)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                showAllAdmin
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-slate-300 bg-slate-100 text-slate-700'
              }`}
            >
              {showAllAdmin ? t('calendar.all_team') : t('calendar.my_calendar')}
            </button>
          )}
          <div className="flex rounded-md border">
            {(['day', 'week'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs font-medium ${
                  view === v
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t(`calendar.view.${v}`)}
              </button>
            ))}
          </div>
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
