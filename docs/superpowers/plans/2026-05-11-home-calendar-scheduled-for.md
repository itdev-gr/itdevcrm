# Home page calendar + Lead "Scheduled for"

> Use superpowers:executing-plans. Each task ends in a commit.

## Goal

Replace the placeholder home page with a working **calendar** showing what's coming up for the signed-in user — Day / Week / Month views — and add a **"Scheduled for"** datetime field on the lead form. Setting that field:

1. Auto-moves the lead to the sales **Scheduled** stage (one of the existing 10 stages — code `scheduled`, position 60).
2. Surfaces the lead on the calendar on that date/time.

Default: each user sees only their own scheduled leads (`owner_user_id = auth.uid()`); admins see everyone. Matches the existing kanban scope pattern.

## File map

**New files:**
- `supabase/migrations/20260511000003_scheduled_for.sql` — adds `leads.scheduled_for`, index, trigger that auto-moves stage when scheduled_for transitions from null → set or changes.
- `src/features/home/CalendarPage.tsx` — calendar shell (header + view toggle + nav + body).
- `src/features/home/MonthView.tsx`, `WeekView.tsx`, `DayView.tsx`.
- `src/features/home/hooks/useScheduledLeads.ts` — fetches leads with `scheduled_for` in a date range, Realtime subscribed.
- `src/i18n/locales/{en,el}/home.json` — calendar labels.

**Modified files:**
- `src/app/routes/HomePage.tsx` — render `<CalendarPage />`.
- `src/features/leads/LeadForm.tsx` — add a datetime-local input "Scheduled for", in the same Sales section grid next to Payment method.
- `src/types/supabase.ts` — regen.
- `src/lib/queryKeys.ts` — `scheduledLeads(rangeStart, rangeEnd, ownerScope)`.
- `src/lib/i18n.ts` — register `home` namespace.

---

## Task 1: Migration — leads.scheduled_for + auto-stage trigger

**Files:** Create `supabase/migrations/20260511000003_scheduled_for.sql`.

- [ ] **Step 1: Migration**

```sql
alter table public.leads
  add column if not exists scheduled_for timestamptz;

create index if not exists leads_scheduled_for
  on public.leads (scheduled_for)
  where scheduled_for is not null and archived = false;

-- Auto-move to the sales 'scheduled' stage whenever scheduled_for changes
-- to a non-null value, except when the lead is in a terminal stage
-- (won, not_interested, dead_end) — those shouldn't be dragged backwards.
create or replace function public.leads_sync_stage_on_scheduled_for()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  scheduled_stage_id uuid;
  current_stage_code text;
begin
  if new.scheduled_for is null then return new; end if;
  if new.scheduled_for is not distinct from old.scheduled_for then return new; end if;

  select code into current_stage_code
    from public.pipeline_stages where id = new.stage_id;
  if current_stage_code in ('won', 'not_interested', 'dead_end', 'scheduled') then
    return new;
  end if;

  select id into scheduled_stage_id
    from public.pipeline_stages
   where board = 'sales' and code = 'scheduled' and archived = false
   limit 1;
  if scheduled_stage_id is null then return new; end if;

  new.stage_id := scheduled_stage_id;
  return new;
end $$;

drop trigger if exists leads_sync_stage_on_scheduled_for on public.leads;
create trigger leads_sync_stage_on_scheduled_for
  before update of scheduled_for on public.leads
  for each row execute function public.leads_sync_stage_on_scheduled_for();
```

- [ ] **Step 2: Apply + types**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
SUPABASE_ACCESS_TOKEN=<token> npm run types:gen
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260511000003_scheduled_for.sql src/types/supabase.ts
git commit -m "feat(leads): scheduled_for + auto-move to Scheduled stage"
```

---

## Task 2: Lead form — Scheduled-for field

**Files:** Modify `src/features/leads/LeadForm.tsx`.

- [ ] **Step 1: State + autosave**

```ts
const [scheduledFor, setScheduledFor] = useState<string>(
  lead.scheduled_for
    ? new Date(lead.scheduled_for).toISOString().slice(0, 16) // for datetime-local
    : '',
);
// ...
// in the payload, alongside payment_method:
scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
```

- [ ] **Step 2: Input** — render inside the same `grid-cols-2` row next to Payment method:

```tsx
<div>
  <Label htmlFor="scheduled-for">{t('form.scheduled_for', { defaultValue: 'Scheduled for' })}</Label>
  <input
    id="scheduled-for"
    type="datetime-local"
    value={scheduledFor}
    onChange={(e) => setScheduledFor(e.target.value)}
    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    disabled={readOnly}
  />
  <p className="mt-1 text-[11px] text-slate-500">
    {t('form.scheduled_for_hint', {
      defaultValue: 'Picking a date moves the lead to Scheduled and adds it to the home calendar.',
    })}
  </p>
</div>
```

- [ ] **Step 3: Add to leads namespace** — extend `src/i18n/locales/{en,el}/leads.json` with the new keys.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git commit -m "feat(leads): Scheduled-for datetime field auto-stages the lead"
```

---

## Task 3: useScheduledLeads hook

**Files:** Create `src/features/home/hooks/useScheduledLeads.ts`, modify `src/lib/queryKeys.ts`.

- [ ] **Step 1: queryKey**

```ts
scheduledLeads: (start: string, end: string, ownerId: string | null) =>
  ['scheduled-leads', start, end, ownerId] as const,
```

- [ ] **Step 2: Hook**

Fetches `leads` rows with `scheduled_for between start and end`, optionally filtered by `owner_user_id` (when caller passes a non-null id — admin passes null). Selects: `id, code, title, scheduled_for, owner_user_id, contact_first_name, contact_last_name, company_name, stage:pipeline_stages(code, display_names)`. Realtime subscribes to leads with no filter (server-side filtering by date isn't trivial in postgres_changes — accept a broader stream and invalidate).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(home): useScheduledLeads — date-range query + Realtime"
```

---

## Task 4: Calendar component

**Files:** Create `src/features/home/CalendarPage.tsx`, `MonthView.tsx`, `WeekView.tsx`, `DayView.tsx`, plus the home i18n files.

- [ ] **Step 1: Shell** — `CalendarPage` owns state: `view: 'day' | 'week' | 'month'` and `cursor: Date`. Renders a header with prev / today / next, the current period label, and a 3-button view toggle.

- [ ] **Step 2: Period calc** — pure helpers (no library):
  - Day view: range = [start-of-day, end-of-day].
  - Week view: range = [Monday-of-cursor, Sunday-end].
  - Month view: range = [first day of grid (may be in prev month), last day of grid].

- [ ] **Step 3: Views**
  - DayView: vertical timeline (hours 8 — 21), items positioned by `scheduled_for` time.
  - WeekView: 7 columns × hour rows, items positioned per column/hour.
  - MonthView: 6×7 grid; each cell shows a count chip + up to 3 inline mini-items; clicking a day switches the view to Day.

- [ ] **Step 4: Item card** — every entry is a `Link` to `/leads/<id>` showing time + headline (contact name or company). Tooltip with the stage and the lead code.

- [ ] **Step 5: i18n** — `home.calendar.title`, `home.calendar.today`, `home.calendar.empty`, weekday + month names already covered by `Intl.DateTimeFormat` (no hard-coded strings).

- [ ] **Step 6: Build + commit**

```bash
npm run build
git commit -m "feat(home): calendar with day/week/month views, scheduled leads"
```

---

## Task 5: Home page wiring

**Files:** Modify `src/app/routes/HomePage.tsx`.

- [ ] **Step 1: Wire** — replace the placeholder content with `<CalendarPage />`. Drop the `{t('tagline')}` paragraph.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git commit -m "feat(home): replace placeholder with calendar"
```

---

## Task 6: Smoke + push

- [ ] **Step 1: Manual smoke**
1. Open a lead → set Scheduled for to a date+time → row updates and the lead jumps to the **Scheduled** column on `/sales/kanban`.
2. Open `/` → see the lead on today's / that-day's calendar entry.
3. Toggle Day → Week → Month views; navigate prev / today / next.
4. Edit the scheduled_for to a different date → calendar updates live; kanban stays in Scheduled.
5. As admin, the calendar shows scheduled leads owned by any user.

- [ ] **Step 2: Push**

```bash
git push origin main
```
