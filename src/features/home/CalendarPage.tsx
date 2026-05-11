import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/stores/authStore';
import { useScheduledLeads, type ScheduledLead } from './hooks/useScheduledLeads';

type View = 'day' | 'week' | 'month';

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
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
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
  if (view === 'week') return { start: startOfWeek(cursor), end: addDays(startOfWeek(cursor), 7) };
  // month: extend to fill the 6×7 grid
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(gridStart, 42);
  return { start: gridStart, end: gridEnd };
}

function leadHeadline(l: ScheduledLead): string {
  const contact = [l.contact_first_name, l.contact_last_name].filter(Boolean).join(' ').trim();
  return contact || l.company_name || l.title || '—';
}

function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

// ── views ────────────────────────────────────────────────────────────────────

function DayView({ cursor, items, locale }: { cursor: Date; items: ScheduledLead[]; locale: string }) {
  const { t } = useTranslation('home');
  const today = items.filter((l) => sameDay(new Date(l.scheduled_for), cursor));
  if (today.length === 0) {
    return (
      <div className="rounded-md border bg-slate-50 p-6 text-center text-sm text-slate-500">
        {t('calendar.empty_day')}
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {today.map((l) => (
        <li key={l.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
          <span className="w-16 shrink-0 font-mono text-xs text-slate-600">
            {formatTime(l.scheduled_for, locale)}
          </span>
          <Link
            to={`/leads/${l.id}`}
            className="min-w-0 flex-1 truncate text-sm font-medium text-blue-700 hover:underline"
          >
            {leadHeadline(l)}
          </Link>
          {l.code && <span className="text-[10px] text-slate-400">{l.code}</span>}
        </li>
      ))}
    </ul>
  );
}

function WeekView({ cursor, items, locale }: { cursor: Date; items: ScheduledLead[]; locale: string }) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const itemsByDay = new Map<string, ScheduledLead[]>();
  for (const d of days) itemsByDay.set(d.toDateString(), []);
  for (const l of items) {
    const k = new Date(l.scheduled_for).toDateString();
    itemsByDay.get(k)?.push(l);
  }
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' });
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const list = itemsByDay.get(d.toDateString()) ?? [];
        const isToday = sameDay(d, new Date());
        return (
          <div key={d.toDateString()} className="flex min-h-[10rem] flex-col rounded-md border bg-white">
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
                list.map((l) => (
                  <li key={l.id}>
                    <Link
                      to={`/leads/${l.id}`}
                      className="block rounded bg-blue-50 px-1.5 py-1 text-blue-800 hover:bg-blue-100"
                    >
                      <span className="font-mono text-[10px] opacity-70">
                        {formatTime(l.scheduled_for, locale)}
                      </span>{' '}
                      <span className="truncate">{leadHeadline(l)}</span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({
  cursor,
  items,
  locale,
  onPickDay,
}: {
  cursor: Date;
  items: ScheduledLead[];
  locale: string;
  onPickDay: (d: Date) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const itemsByDay = new Map<string, ScheduledLead[]>();
  for (const l of items) {
    const k = new Date(l.scheduled_for).toDateString();
    if (!itemsByDay.has(k)) itemsByDay.set(k, []);
    itemsByDay.get(k)!.push(l);
  }
  const today = new Date();
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i}>{weekdayFmt.format(addDays(gridStart, i))}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const list = itemsByDay.get(d.toDateString()) ?? [];
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          return (
            <button
              key={d.toDateString()}
              type="button"
              onClick={() => onPickDay(d)}
              className={`flex min-h-[6rem] flex-col items-stretch rounded-md border p-1 text-left text-xs transition-colors ${
                inMonth ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
              } ${isToday ? 'border-blue-300 ring-2 ring-blue-100' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={`font-medium ${isToday ? 'text-blue-700' : ''}`}>{d.getDate()}</span>
                {list.length > 0 && (
                  <span className="rounded-full bg-blue-100 px-1.5 text-[10px] font-medium text-blue-700">
                    {list.length}
                  </span>
                )}
              </div>
              <ul className="mt-1 space-y-0.5">
                {list.slice(0, 2).map((l) => (
                  <li key={l.id} className="truncate text-[10px] text-blue-800">
                    {formatTime(l.scheduled_for, locale)} {leadHeadline(l)}
                  </li>
                ))}
                {list.length > 2 && (
                  <li className="text-[10px] text-slate-400">+{list.length - 2}</li>
                )}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── shell ────────────────────────────────────────────────────────────────────

export function CalendarPage() {
  const { t, i18n } = useTranslation('home');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? '');

  const [view, setView] = useState<View>('week');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [showAllAdmin, setShowAllAdmin] = useState(false);

  const { start, end } = useMemo(() => rangeFor(view, cursor), [view, cursor]);
  const ownerUserId = isAdmin && showAllAdmin ? null : userId || null;

  const { data: items = [] } = useScheduledLeads({ start, end, ownerUserId });

  function shift(delta: number) {
    if (view === 'day') setCursor((c) => addDays(c, delta));
    else if (view === 'week') setCursor((c) => addDays(c, delta * 7));
    else
      setCursor((c) => {
        const next = new Date(c);
        next.setMonth(next.getMonth() + delta);
        return next;
      });
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
    if (view === 'week') {
      const s = startOfWeek(cursor);
      const e = addDays(s, 6);
      const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
      return `${fmt.format(s)} – ${fmt.format(e)}`;
    }
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(cursor);
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
            {(['day', 'week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs font-medium ${
                  view === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t(`calendar.view.${v}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'day' && <DayView cursor={cursor} items={items} locale={locale} />}
        {view === 'week' && <WeekView cursor={cursor} items={items} locale={locale} />}
        {view === 'month' && (
          <MonthView
            cursor={cursor}
            items={items}
            locale={locale}
            onPickDay={(d) => {
              setCursor(d);
              setView('day');
            }}
          />
        )}
      </div>
    </div>
  );
}
