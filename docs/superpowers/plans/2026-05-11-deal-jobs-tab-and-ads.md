# Deal Jobs tab + Ads end-to-end

> Use superpowers:executing-plans. Each task ends in a commit.

## Problem

Two related issues, both surfaced when an accounting user moves a deal to `partial_payment` (jobs spawn blocked except web_dev) or `paid_in_full` (jobs unblock / spawn unblocked):

1. **The Jobs tab on the deal detail page is a placeholder.** `DealDetailPage.tsx:214` literally renders `"Jobs (Phase 6)"`. The jobs the trigger / RPC creates exist in the DB and the corresponding tech kanban, but the deal page itself doesn't show them.

2. **Ads services in a deal are silently dropped.** The form now lets sales add `service_type='ads'`, but the backend has four matching gaps so no Ads job is ever created when accounting completes:
   - `release_jobs_for_deal` allow-list excludes `'ads'` → silent skip in the loop.
   - `jobs_service_type_check` CHECK constraint doesn't accept `'ads'` → INSERT would 23514 even if the allow-list were patched.
   - No `pipeline_stages` rows for `board='ads'` → job would have NULL stage_id and not render on any kanban.
   - No `service_monthly_task_templates` row for `'ads'` → recurring Ads jobs would show an empty monthly-task panel.

The `groups.code='ads'` row already exists; the recurring-payments + PaymentsPanel UI already handles billing for ads. Investigation samples — completed deals 000010 / 000012 / 000016 each spawned the correct 2 jobs, confirming the non-ads flow works.

## Default design decision (override if wrong)

**Ads gets its own `/tech/ads` kanban** matching how Web SEO / Local SEO / Social Media work today: dedicated `pipeline_stages` on `board='ads'` (onboarding → audit_strategy → active → on_hold → cancelled), sidebar entry visible to members of the `ads` group, monthly task template covering "Budget review / Performance report / Creative refresh" etc.

This mirrors the existing pattern rather than folding ads into another team's kanban. Reverse only if Ads is actually delivered by an existing team (Social Media is the most likely candidate) — see comment in Task 4.

## File map

**New files:**
- `supabase/migrations/20260511000001_ads_service_support.sql` — extends `jobs_service_type_check`, seeds `pipeline_stages` for `board='ads'`, updates `release_jobs_for_deal` allow-list, seeds `service_monthly_task_templates` for `'ads'`, extends `tech_my_clients` so ads activity shows under itself.
- `src/features/deals/JobsTab.tsx` — list of jobs for the deal, with service / stage / blocked / owner / per-job link.
- `src/features/jobs/hooks/useJobsForDeal.ts` — fetch + Realtime invalidate.

**Modified files:**
- `src/features/deals/DealDetailPage.tsx` — replace placeholder with `<JobsTab />`.
- `src/features/clients/ClientDetailPage.tsx` — reuse `JobsTab` (per-client) or add a thin `useJobsForClient` variant if not already there.
- `src/app/router.tsx` — `/tech/ads` route.
- `src/components/layout/Sidebar.tsx` — register `'ads'` in `TECH_GROUPS`.
- `src/features/jobs/hooks/useJobs.ts` — `ServiceType` already includes `'ads'`; no change.
- `src/features/jobs/JobsKanbanPage.tsx` — `SERVICE_LABELS` already includes `'ads'`; no change.
- `src/lib/queryKeys.ts` — `jobsForDeal(dealId)`.

---

## Task 1: Migration — allow ads everywhere it needs to land

**Files:**
- Create: `supabase/migrations/20260511000001_ads_service_support.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 1. Allow 'ads' in jobs.service_type.
alter table public.jobs
  drop constraint if exists jobs_service_type_check;
alter table public.jobs
  add constraint jobs_service_type_check
  check (service_type in
    ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting', 'ads'));

-- 2. Seed pipeline_stages for board='ads' (mirror web_seo's stage codes so
--    the kanban behaves identically). Idempotent.
insert into public.pipeline_stages
  (board, code, display_names, position, is_terminal)
values
  ('ads', 'onboarding',     '{"en":"Onboarding","el":"Onboarding"}'::jsonb,     10, false),
  ('ads', 'audit_strategy', '{"en":"Audit / Strategy","el":"Audit / Στρατηγική"}'::jsonb, 20, false),
  ('ads', 'active',         '{"en":"Active","el":"Ενεργό"}'::jsonb,             30, false),
  ('ads', 'on_hold',        '{"en":"On Hold","el":"Σε Αναμονή"}'::jsonb,         40, false),
  ('ads', 'cancelled',      '{"en":"Cancelled","el":"Ακυρωμένο"}'::jsonb,        50, true)
on conflict (board, code) do update
  set display_names = excluded.display_names,
      position = excluded.position,
      is_terminal = excluded.is_terminal,
      archived = false;

-- 3. release_jobs_for_deal: add 'ads' to the allow-list. Drop the case-map
--    for ai_seo→web_seo board (already in place from 20260509000005), keep
--    everything else the same.
create or replace function public.release_jobs_for_deal(
  target_deal_id uuid,
  partial_payment_mode boolean
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d record;
  service jsonb;
  service_type_val text;
  stage_board text;
  billing_type_val text;
  one_time_amt numeric;
  monthly_amt numeric;
  setup_fee_val numeric;
  group_id_val uuid;
  job_stage_id uuid;
  inserted int := 0;
  should_block boolean;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;

  for service in select * from jsonb_array_elements(d.services_planned)
  loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';

    if service_type_val not in
       ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting', 'ads') then
      continue;
    end if;
    if billing_type_val not in ('one_time', 'recurring_monthly', 'recurring_yearly') then
      continue;
    end if;

    if exists (
      select 1 from public.jobs
       where deal_id = d.id
         and service_type = service_type_val
         and archived = false
    ) then
      continue;
    end if;

    one_time_amt := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block := partial_payment_mode and service_type_val <> 'web_dev';

    select id into group_id_val from public.groups where code = service_type_val;

    stage_board := case service_type_val when 'ai_seo' then 'web_seo' else service_type_val end;

    select id into job_stage_id
      from public.pipeline_stages
     where board = stage_board
       and code = case service_type_val
         when 'web_dev' then 'awaiting_brief'
         when 'hosting' then 'setup'
         else 'onboarding'
       end
       and archived = false
     limit 1;

    insert into public.jobs (
      deal_id, client_id, service_type, billing_type,
      one_time_amount, monthly_amount, setup_fee,
      stage_id, assigned_group_id, status, started_at, code,
      is_blocked, blocked_reason, blocked_at
    ) values (
      d.id, d.client_id, service_type_val, billing_type_val,
      one_time_amt, monthly_amt, setup_fee_val,
      job_stage_id, group_id_val, 'active', now(), d.code,
      should_block,
      case when should_block then 'partial_payment_pending' else null end,
      case when should_block then now() else null end
    );
    inserted := inserted + 1;
  end loop;

  return inserted;
end $$;

grant execute on function public.release_jobs_for_deal(uuid, boolean) to authenticated;

-- 4. Monthly task template for ads (recurring billing surface).
insert into public.service_monthly_task_templates (service_type, tasks)
values ('ads', '[
  {"code":"budget_check","label_en":"Confirm monthly budget","label_el":"Επιβεβαίωση μηνιαίου budget"},
  {"code":"creative_refresh","label_en":"Refresh creatives","label_el":"Ανανέωση creatives"},
  {"code":"performance_report","label_en":"Send performance report","label_el":"Αποστολή report απόδοσης"},
  {"code":"optimization_pass","label_en":"Run optimization pass","label_el":"Optimization pass"}
]'::jsonb)
on conflict (service_type) do nothing;

-- 5. tech_my_clients: include ads activity under itself (no fold).
create or replace view public.tech_my_clients
with (security_invoker = true) as
with base as (
  select j.service_type, j.client_id, j.updated_at, j.status, j.is_blocked
    from public.jobs j
   where j.archived = false
     and j.status <> 'cancelled'
     and j.updated_at > now() - interval '90 days'
),
sources as (
  select service_type, client_id, updated_at, status, is_blocked
    from base where service_type <> 'ai_seo'
  union all
  select 'web_seo'::text,  client_id, updated_at, status, is_blocked from base where service_type = 'ai_seo'
  union all
  select 'local_seo'::text, client_id, updated_at, status, is_blocked from base where service_type = 'ai_seo'
)
select s.service_type, c.id as client_id, c.name as client_name, c.industry,
       c.status as client_status, c.email, c.contact_first_name, c.contact_last_name,
       max(s.updated_at) as last_activity,
       count(*) filter (where s.status = 'active') as active_jobs,
       bool_or(s.is_blocked) as any_blocked
from sources s
join public.clients c on c.id = s.client_id
group by s.service_type, c.id, c.name, c.industry, c.status, c.email,
         c.contact_first_name, c.contact_last_name;

grant select on public.tech_my_clients to authenticated;
```

- [ ] **Step 2: Apply + regen types + commit**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
SUPABASE_ACCESS_TOKEN=<token> npm run types:gen
git add supabase/migrations/20260511000001_ads_service_support.sql src/types/supabase.ts
git commit -m "feat(ads): make ads a real service — schema, stages, RPC, monthly tasks"
```

---

## Task 2: Sidebar + router — add `/tech/ads`

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/app/router.tsx`

- [ ] **Step 1: Sidebar** — add `'ads'` to `TECH_GROUPS`, with `TECH_LABELS.ads = 'Ads'` and matching `TECH_ROUTES` / `TECH_CLIENTS_ROUTES` entries.

- [ ] **Step 2: Router** — add `{ path: 'ads', element: <JobsKanbanPage serviceType="ads" /> }` inside the `/tech` children. Also extend the `RequireGroup` array on `/tech` to include `'ads'` so ads-group members can reach it.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git commit -m "feat(ads): /tech/ads kanban route + sidebar entry"
```

---

## Task 3: `JobsTab` for the deal detail page

**Files:**
- Create: `src/features/jobs/hooks/useJobsForDeal.ts`
- Create: `src/features/deals/JobsTab.tsx`
- Modify: `src/lib/queryKeys.ts` (add `jobsForDeal(id)`)
- Modify: `src/features/deals/DealDetailPage.tsx`

- [ ] **Step 1: Hook**

```ts
// useJobsForDeal.ts
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { JobRow } from './useJobs';

export function useJobsForDeal(dealId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.jobsForDeal(dealId),
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(
          '*, stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
        .eq('deal_id', dealId)
        .eq('archived', false)
        .order('service_type');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as JobRow[];
    },
    enabled: !!dealId,
  });
  useEffect(() => {
    if (!dealId) return;
    const ch = supabase
      .channel(`jobs-for-deal-${dealId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `deal_id=eq.${dealId}` },
        () => void qc.invalidateQueries({ queryKey: queryKeys.jobsForDeal(dealId) }),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [dealId, qc]);
  return query;
}
```

- [ ] **Step 2: `JobsTab.tsx`**

Each row shows: service label, billing type, stage badge with the kanban code in the active language, blocked badge (with reason), amount, link to `/jobs/<id>`, and a small "Open in kanban" link to `/tech/<slug>` (slug mapping web_seo → web-seo etc.). Empty-state copy when zero jobs:
- If deal is in `accounting_completed_at != null` → "No jobs were spawned. Check that services_planned has valid entries."
- Otherwise → "Jobs will be created when this deal reaches Partial Payment (blocked until full payment, except Web Dev) or Paid in Full."

- [ ] **Step 3: Wire** — replace the placeholder paragraph at `DealDetailPage.tsx:214` with `<JobsTab dealId={dealId} />`. Add the `jobsForDeal` key to `queryKeys.ts`.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git commit -m "feat(deals): real Jobs tab on deal detail (replaces Phase 6 placeholder)"
```

---

## Task 4: Verify end-to-end + ship

- [ ] **Step 1: Smoke** — on dev, pick a deal in `awaiting_payment`, drag it to **Partial Payment**:
  - `release_jobs_for_deal(d.id, true)` fires → N jobs created.
  - All have `is_blocked = true` and `blocked_reason = 'partial_payment_pending'` EXCEPT the web_dev one.
  - The Jobs tab on the deal lists them with the correct stage + blocked badges.
  - `/tech/web-seo` / `/tech/local-seo` / `/tech/web-dev` / `/tech/social-media` / `/tech/hosting` / `/tech/ads` each show the matching job in **Onboarding** / **Awaiting brief** / **Setup**.

- [ ] **Step 2: Smoke (paid_in_full)** — drag the same deal to **Paid In Full**:
  - `complete_accounting` runs → existing jobs have their `is_blocked` cleared; no duplicate jobs.
  - Jobs tab shows zero blocked badges.

- [ ] **Step 3: Smoke (ads-only edge case)** — create a brand new deal with only an Ads service, run it through partial_payment + paid_in_full:
  - Ads job created on `/tech/ads` board, `onboarding` stage, with the seeded monthly task template.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Rollback notes

The migration is forward-only. Reversing means dropping the ads stages (5 rows), removing 'ads' from the CHECK constraint, and reverting `release_jobs_for_deal`. The `tech_my_clients` view reverts to the prior shape.
