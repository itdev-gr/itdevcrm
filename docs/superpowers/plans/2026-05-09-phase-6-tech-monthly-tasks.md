# Phase 6 — Technical sub-departments: monthly tasks + My Clients + filter

> Use superpowers:executing-plans. Each task ends in a commit.

**Goal:** Close the remaining gaps in Phase 6 so the technical groups have a working day-to-day surface:

1. A **monthly task panel** on every recurring job, seeded from a per-service-type template, ticked off by the assigned tech, archived to `activity_log` and reset on the 1st of each month.
2. A **"My Clients"** page for each tech group (web_seo, local_seo, web_dev, social_media, ai_seo, hosting), showing every client where that group has a non-cancelled job in the last 90 days.
3. A **kanban filter chip** on each tech kanban toggling between "Only mine" (jobs I own) and "All my group's clients" (every job for the service_type).

**Already built (`3c83323`):** tech kanbans, JobDetailPage, block/unblock, sidebar, RequireGroup guards, accounting recurring board.

**Schema columns already in place** on `jobs`: `monthly_tasks jsonb`, `monthly_tasks_period text` (YYYY-MM).

---

## Task 1: Schema — `service_monthly_task_templates` + seed

**Files:**
- Create: `supabase/migrations/20260509000001_monthly_task_templates.sql`

- [ ] **Step 1: Migration**

```sql
create table public.service_monthly_task_templates (
  service_type text primary key
    check (service_type in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads')),
  tasks jsonb not null default '[]'::jsonb,
  -- shape: [{ "code":"keyword_check", "label_en":"Run keyword check", "label_el":"…" }]
  updated_at timestamptz not null default now()
);

create trigger service_monthly_task_templates_set_updated_at
  before update on public.service_monthly_task_templates
  for each row execute function public.set_updated_at();

alter table public.service_monthly_task_templates enable row level security;

create policy smtt_select on public.service_monthly_task_templates
  for select to authenticated using (true);

create policy smtt_mutate_admin on public.service_monthly_task_templates
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- Seed defaults. Web Dev / Hosting are mostly one-time so skip; agencies fill in
-- via the upsert pattern when admin UI lands. For now seed the four recurring
-- service types with reasonable starter checklists.
insert into public.service_monthly_task_templates (service_type, tasks) values
  ('web_seo', '[
    {"code":"keyword_review","label_en":"Review target keywords","label_el":"Έλεγχος keywords"},
    {"code":"backlink_audit","label_en":"Backlink audit","label_el":"Έλεγχος backlinks"},
    {"code":"content_publish","label_en":"Publish 1 article","label_el":"Δημοσίευση 1 άρθρου"},
    {"code":"rank_report","label_en":"Send ranking report","label_el":"Αποστολή report κατάταξης"}
  ]'::jsonb),
  ('local_seo', '[
    {"code":"gbp_post","label_en":"Google Business post","label_el":"Ανάρτηση Google Business"},
    {"code":"citation_check","label_en":"Citation consistency","label_el":"Έλεγχος citations"},
    {"code":"review_ask","label_en":"Ask for client reviews","label_el":"Αίτημα reviews"},
    {"code":"local_report","label_en":"Send local report","label_el":"Αποστολή local report"}
  ]'::jsonb),
  ('social_media', '[
    {"code":"content_calendar","label_en":"Content calendar approved","label_el":"Έγκριση content calendar"},
    {"code":"posts_published","label_en":"All posts published","label_el":"Όλες οι αναρτήσεις δημοσιεύτηκαν"},
    {"code":"engagement_reply","label_en":"Replied to comments / DMs","label_el":"Απαντήσεις σε σχόλια / DMs"},
    {"code":"social_report","label_en":"Send monthly metrics","label_el":"Αποστολή μηνιαίων metrics"}
  ]'::jsonb),
  ('ai_seo', '[
    {"code":"prompt_audit","label_en":"AI search prompt audit","label_el":"Έλεγχος AI search prompts"},
    {"code":"llm_citation_check","label_en":"LLM citation check","label_el":"Έλεγχος LLM citations"},
    {"code":"ai_report","label_en":"Send AI visibility report","label_el":"Αποστολή AI visibility report"}
  ]'::jsonb)
on conflict (service_type) do nothing;
```

- [ ] **Step 2: Push + types**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
SUPABASE_ACCESS_TOKEN=<token> npm run types:gen
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260509000001_monthly_task_templates.sql src/types/supabase.ts
git commit -m "feat(jobs): service_monthly_task_templates + seed for 4 recurring services"
```

---

## Task 2: RPCs — seed + toggle a task

**Files:**
- Create: `supabase/migrations/20260509000002_monthly_task_rpcs.sql`

- [ ] **Step 1: Migration**

```sql
-- Seeds jobs.monthly_tasks from the template if the period is null or stale.
-- Idempotent — safe to call on every page load.
create or replace function public.ensure_job_monthly_task_period(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text;
  v_period text;
  v_current text := to_char(now(), 'YYYY-MM');
  v_template jsonb;
  v_tasks jsonb;
begin
  select service_type, monthly_tasks_period into v_service, v_period
  from public.jobs where id = p_job_id;

  if v_service is null then return; end if;
  if v_period = v_current then return; end if;
  if v_period is not null and v_period <> v_current then
    -- A stale period means the cron didn't run yet (or this is a new job in
    -- mid-month). The cron archives. Here we just refresh into the new period.
    null;
  end if;

  select tasks into v_template
  from public.service_monthly_task_templates where service_type = v_service;
  if v_template is null then v_template := '[]'::jsonb; end if;

  -- Build task rows with completed=false. Preserve any `code` already ticked
  -- this period if we're called twice in the same month.
  v_tasks := (
    select coalesce(jsonb_agg(
      jsonb_build_object('code', t->>'code', 'completed', false, 'completed_at', null, 'completed_by', null)
    ), '[]'::jsonb)
    from jsonb_array_elements(v_template) t
  );

  update public.jobs
     set monthly_tasks = v_tasks,
         monthly_tasks_period = v_current
   where id = p_job_id;
end $$;

grant execute on function public.ensure_job_monthly_task_period(uuid) to authenticated;

-- Toggle a single task code in the current period. Enforces edit permission.
create or replace function public.set_job_monthly_task(
  p_job_id uuid, p_code text, p_completed boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text;
  v_blocked boolean;
  v_can boolean;
begin
  perform public.ensure_job_monthly_task_period(p_job_id);

  select service_type, is_blocked into v_service, v_blocked
  from public.jobs where id = p_job_id;
  if v_service is null then raise exception 'job not found'; end if;
  if v_blocked then raise exception 'job is blocked'; end if;

  v_can := public.current_user_is_admin()
        or public.current_user_can(v_service, 'edit');
  if not v_can then raise exception 'forbidden'; end if;

  update public.jobs
  set monthly_tasks = (
    select coalesce(jsonb_agg(
      case when (t->>'code') = p_code
        then jsonb_set(jsonb_set(jsonb_set(t,
              '{completed}', to_jsonb(p_completed)),
              '{completed_at}', case when p_completed then to_jsonb(now()) else 'null'::jsonb end),
              '{completed_by}', case when p_completed then to_jsonb(auth.uid()) else 'null'::jsonb end)
        else t end
    ), '[]'::jsonb)
    from jsonb_array_elements(monthly_tasks) t
  )
  where id = p_job_id;
end $$;

grant execute on function public.set_job_monthly_task(uuid, text, boolean) to authenticated;
```

- [ ] **Step 2: Push + commit**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
git add supabase/migrations/20260509000002_monthly_task_rpcs.sql
git commit -m "feat(jobs): RPCs to seed and toggle monthly task checklists"
```

---

## Task 3: Monthly reset cron

**Files:**
- Create: `supabase/migrations/20260509000003_monthly_task_reset_cron.sql`

- [ ] **Step 1: Migration**

```sql
-- Daily job: on the 1st of every month, archive each recurring job's prior
-- monthly_tasks payload to activity_log and reseed from template.
create or replace function public.run_monthly_task_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text := to_char(now(), 'YYYY-MM');
  r record;
begin
  for r in
    select j.id, j.service_type, j.monthly_tasks, j.monthly_tasks_period,
           t.tasks as template_tasks
      from public.jobs j
      left join public.service_monthly_task_templates t on t.service_type = j.service_type
     where j.archived = false
       and j.status = 'active'
       and j.billing_type = 'recurring_monthly'
       and (j.monthly_tasks_period is null or j.monthly_tasks_period <> v_current)
  loop
    -- Archive prior period if there was one.
    if r.monthly_tasks_period is not null then
      insert into public.activity_log (entity_type, entity_id, user_id, action, changes)
      values ('jobs', r.id, null, 'update', jsonb_build_object(
        'kind', 'monthly_tasks_archived',
        'period', r.monthly_tasks_period,
        'tasks', r.monthly_tasks
      ));
    end if;

    update public.jobs
       set monthly_tasks = coalesce((
             select jsonb_agg(jsonb_build_object(
               'code', t->>'code',
               'completed', false,
               'completed_at', null,
               'completed_by', null
             ))
             from jsonb_array_elements(coalesce(r.template_tasks, '[]'::jsonb)) t
           ), '[]'::jsonb),
           monthly_tasks_period = v_current
     where id = r.id;
  end loop;
end $$;

-- Schedule: run daily at 02:15 UTC. The function is a no-op on non-1st days
-- only when periods already match — but recurring jobs created mid-month also
-- get caught by this same loop so their first call seeds them.
do $$
begin
  perform 1 from cron.job where jobname = 'monthly_task_reset_daily';
  if not found then
    perform cron.schedule(
      'monthly_task_reset_daily', '15 2 * * *',
      $cron$select public.run_monthly_task_reset();$cron$
    );
  end if;
end $$;
```

- [ ] **Step 2: Smoke (optional, manual)** — run `select public.run_monthly_task_reset();` against the dev DB. Confirm `monthly_tasks_period` advances on a sample job.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260509000003_monthly_task_reset_cron.sql
git commit -m "feat(jobs): daily cron — archive + reseed monthly tasks on month rollover"
```

---

## Task 4: Hooks for monthly tasks

**Files:**
- Create: `src/features/jobs/hooks/useJobMonthlyTasks.ts`
- Create: `src/features/jobs/hooks/useToggleMonthlyTask.ts`
- Modify: `src/lib/queryKeys.ts` (add `jobMonthlyTasks(jobId)`)

- [ ] **Step 1: Query key** — add `jobMonthlyTasks: (id: string) => ['job-monthly-tasks', id] as const`.

- [ ] **Step 2: `useJobMonthlyTasks(jobId)`** — calls `rpc('ensure_job_monthly_task_period', { p_job_id })`, then re-fetches the job's `monthly_tasks` + `monthly_tasks_period` and the template (`service_monthly_task_templates`) so we can render labels in the active language.

- [ ] **Step 3: `useToggleMonthlyTask`** — wraps `rpc('set_job_monthly_task', …)` with `captureMutation('jobs','toggle_monthly_task', …)`; invalidates `jobMonthlyTasks(jobId)` and `job(jobId)`.

- [ ] **Step 4: Build check + commit**

```bash
npm run build
git add src/features/jobs/hooks/useJobMonthlyTasks.ts src/features/jobs/hooks/useToggleMonthlyTask.ts src/lib/queryKeys.ts
git commit -m "feat(jobs): hooks for monthly task panel (ensure + toggle)"
```

---

## Task 5: Monthly task panel UI

**Files:**
- Create: `src/features/jobs/MonthlyTasksPanel.tsx`
- Modify: `src/features/jobs/JobDetailPage.tsx`

- [ ] **Step 1: `MonthlyTasksPanel`** — renders a checkbox list with per-row label (English/Greek), completed-by name + completed_at relative time when ticked, and a section heading like `Tasks for May 2026 · 2/4 done`. Disabled when `is_blocked`. Uses the `users` map from `useAssignableOwners` to resolve `completed_by`.

- [ ] **Step 2: Wire into `JobDetailPage`** — only show when `job.billing_type === 'recurring_monthly'` AND a template exists for the service. Place under the Overview tab as a separate panel above the metadata grid.

- [ ] **Step 3: i18n** — add to `src/i18n/locales/{en,el}/jobs.json` (create namespace if missing): titles, "Tasks for {month}", "of N done", "Cannot edit while blocked".

- [ ] **Step 4: Build + smoke + commit**

```bash
npm run build
git add src/features/jobs/MonthlyTasksPanel.tsx src/features/jobs/JobDetailPage.tsx src/i18n/locales
git commit -m "feat(jobs): monthly task panel on job detail (recurring jobs)"
```

---

## Task 6: Tech-group "My Clients" pages

**Files:**
- Create: `supabase/migrations/20260509000004_tech_my_clients_view.sql`
- Create: `src/features/tech/TechMyClientsPage.tsx`
- Create: `src/features/tech/hooks/useTechMyClients.ts`
- Modify: `src/app/router.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: SQL view**

```sql
create or replace view public.tech_my_clients as
select
  j.service_type,
  c.id as client_id,
  c.name,
  c.industry,
  c.status as client_status,
  max(j.updated_at) as last_activity,
  count(*) filter (where j.status = 'active') as active_jobs,
  bool_or(j.is_blocked) as any_blocked
from public.jobs j
join public.clients c on c.id = j.client_id
where j.archived = false
  and j.status <> 'cancelled'
  and j.updated_at > now() - interval '90 days'
group by j.service_type, c.id, c.name, c.industry, c.status;

grant select on public.tech_my_clients to authenticated;
```

(View inherits RLS from underlying tables.)

- [ ] **Step 2: Hook** — `useTechMyClients(serviceType)` → `select * from tech_my_clients where service_type = ? order by last_activity desc`.

- [ ] **Step 3: Page** — table: client name (link to `/clients/<id>`), industry, status badge, active jobs count, last activity (relative), 🔒 if any_blocked. Search filter on name.

- [ ] **Step 4: Routes** — add `/tech/:serviceType/clients` lazy route (param-driven, one component for all six groups). Guard with `RequireGroup` against the matching tech group.

- [ ] **Step 5: Sidebar** — under each tech group entry, add a sub-link "My Clients" pointing at `/tech/<group>/clients`. Use a small grouping pattern that preserves the existing kanban link as the primary entry.

- [ ] **Step 6: Build + commit**

```bash
npm run build
git add supabase/migrations/20260509000004_tech_my_clients_view.sql src/features/tech src/app/router.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(tech): My Clients page per tech group with 90-day rolling window"
```

---

## Task 7: Kanban "Only mine" filter chip

**Files:**
- Modify: `src/features/jobs/JobsKanbanPage.tsx`

- [ ] **Step 1: Read URL search param** — `mine=1` (default true on first visit). Toggle persists via `setSearchParams`.

- [ ] **Step 2: Filter** — when `mine=1`, filter `jobs` client-side to those where `owner_user_id === auth.userId`. Otherwise show all.

- [ ] **Step 3: UI** — small toggle chip in the page header next to the title: `Only mine` ↔ `All my group's`.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/features/jobs/JobsKanbanPage.tsx
git commit -m "feat(tech): only-mine filter chip on tech kanbans"
```

---

## Task 8: Smoke + push

- [ ] **Step 1: Push migrations**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
```

- [ ] **Step 2: Manual smoke**

1. Open a recurring job → see the monthly task panel with this month's checklist.
2. Tick a task → row updates, completed-by name appears.
3. Block the client → checklist becomes read-only on that job's panel.
4. Open `/tech/web-seo/clients` (as a web_seo group user) → see clients with active web_seo work in last 90 days.
5. On `/tech/web-seo` toggle the chip → only-mine vs all-my-group.
6. Run `select public.run_monthly_task_reset();` against dev → confirm new period.

- [ ] **Step 3: Push**

```bash
git push origin main
```
