# Jobs as the Billing Unit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **COMMIT POLICY (user override):** Do NOT `git commit` or `git push` during execution. All work accumulates uncommitted until the working result is approved on localhost; then commit atomically (one commit per task, retroactively) and push. The "Commit" steps below are therefore "stage only" until approval.

**Goal:** Make a job the single self-contained unit of work + billing — accounting creates/edits jobs (incl. custom ones with title/price/description/department), payments are generated from jobs and can be billed together or separately, and recurring renews per job so nothing is manually recreated.

**Architecture:** Add billing fields to `jobs`; turn `deal_payments` into an invoice header with new `deal_payment_lines` (one line per job); generate payments from jobs via `generate_payments_for_deal`; rewrite `ensure_recurring_payments` to renew per active recurring job/billing-group; expose accounting self-serve via SECURITY DEFINER RPCs; add a unified "Jobs & Billing" panel on the deal page. All schema additive + backfilled; old columns retained for fallback.

**Tech Stack:** Supabase Postgres (SQL migrations, pgTAP, pg_cron, RLS, SECURITY DEFINER RPCs); React 19 + TS + TanStack Query + shadcn/ui; Vitest + RTL.

**Demo target:** runs on localhost (`npm run dev`) against a DB that has these migrations applied — DB target (local Supabase via Docker vs the CRM project) is confirmed with the user before any migration runs (spec §11).

---

## File structure

**Migrations (new, `supabase/migrations/`):**
- `2026..._jobs_billing_columns.sql` — jobs billing fields + `billing_group_id`
- `2026..._deal_payment_lines.sql` — lines table + RLS + generated VAT cols
- `2026..._deal_payments_totals_view.sql` — `deal_payments_with_totals`
- `2026..._backfill_jobs_billing.sql` — backfill job title/amount_net/vat_rate
- `2026..._backfill_payment_lines.sql` — convert existing payments → header+line
- `2026..._generate_payments_for_deal.sql` — job-driven generation fn
- `2026..._job_billing_rpcs.sql` — create_custom_job / update_job_billing / end_job
- `2026..._ensure_recurring_payments_jobs.sql` — job-driven renewal (old kept as _legacy)
- `2026..._spawn_cutover.sql` — point spawn at job-driven generation

**Frontend (new/modified, `src/features/`):**
- `deals/JobsBillingPanel.tsx` (new) — the unified accounting panel
- `deals/AddCustomJobForm.tsx` (new) — create-custom-job form
- `deals/hooks/useJobsBilling.ts` (new) — read jobs + payments(+lines) for a deal
- `deals/hooks/useCustomJobMutations.ts` (new) — create/update/end via RPCs
- `deals/PaymentsPanel.tsx` (modify) — line-aware rendering via totals view
- `deals/DealDetailPage.tsx` (modify) — mount JobsBillingPanel for accounting

**Tests:** pgTAP under `supabase/tests/`; Vitest under each feature folder.

---

## Phase 1 — Schema (additive, safe)

### Task 1: Jobs billing columns

**Files:**
- Create: `supabase/migrations/<ts>_jobs_billing_columns.sql`
- Test: `supabase/tests/jobs_billing_columns_test.sql`

- [ ] **Step 1: Write the failing pgTAP test**
```sql
begin;
select plan(7);
select has_column('public','jobs','title','jobs.title exists');
select has_column('public','jobs','description','jobs.description exists');
select has_column('public','jobs','is_custom','jobs.is_custom exists');
select has_column('public','jobs','amount_net','jobs.amount_net exists');
select has_column('public','jobs','vat_rate','jobs.vat_rate exists');
select has_column('public','jobs','billing_active','jobs.billing_active exists');
select has_column('public','jobs','billing_group_id','jobs.billing_group_id exists');
select * from finish();
rollback;
```
- [ ] **Step 2: Run it, verify FAIL** — `supabase test db` → columns missing.
- [ ] **Step 3: Write the migration**
```sql
-- Jobs become the billing unit: title/description/price/cadence/active flag live on the job.
alter table public.jobs add column if not exists title text;
alter table public.jobs add column if not exists description text;
alter table public.jobs add column if not exists is_custom boolean not null default false;
alter table public.jobs add column if not exists amount_net numeric(12,2);
alter table public.jobs add column if not exists vat_rate numeric(5,2) not null default 24.00;
alter table public.jobs add column if not exists billing_active boolean not null default true;
alter table public.jobs add column if not exists billing_only boolean not null default false;
alter table public.jobs add column if not exists billing_group_id uuid;
create index if not exists jobs_billing_group_idx on public.jobs (billing_group_id) where billing_group_id is not null;
-- ROLLBACK:
-- drop index if exists jobs_billing_group_idx;
-- alter table public.jobs drop column if exists billing_group_id, drop column if exists billing_only,
--   drop column if exists billing_active, drop column if exists vat_rate, drop column if exists amount_net,
--   drop column if exists is_custom, drop column if exists description, drop column if exists title;
```
- [ ] **Step 4: Run it, verify PASS.**
- [ ] **Step 5: Stage** (commit deferred): `git add` the two files.

### Task 2: `deal_payment_lines` table

**Files:**
- Create: `supabase/migrations/<ts>_deal_payment_lines.sql`
- Test: `supabase/tests/deal_payment_lines_test.sql`

- [ ] **Step 1: Failing pgTAP test** — assert table exists, `payment_id`/`job_id`/`amount_net`/`vat_rate` columns exist, `amount_gross` is generated, RLS enabled.
```sql
begin;
select plan(5);
select has_table('public','deal_payment_lines','table exists');
select has_column('public','deal_payment_lines','payment_id','payment_id');
select has_column('public','deal_payment_lines','job_id','job_id');
select has_column('public','deal_payment_lines','amount_gross','amount_gross');
select is(public.rls_enabled('public','deal_payment_lines'), true, 'rls on'); -- helper or use pg_class relrowsecurity
select * from finish();
rollback;
```
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration**
```sql
create table if not exists public.deal_payment_lines (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.deal_payments(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  label text,
  amount_net numeric(12,2) not null default 0 check (amount_net >= 0),
  vat_rate numeric(5,2) not null default 24.00 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount numeric(12,2) generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  amount_gross numeric(12,2) generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored,
  created_at timestamptz not null default now()
);
create index if not exists deal_payment_lines_payment_idx on public.deal_payment_lines (payment_id);
create index if not exists deal_payment_lines_job_idx on public.deal_payment_lines (job_id);
alter table public.deal_payment_lines enable row level security;
create policy deal_payment_lines_select on public.deal_payment_lines for select to authenticated using (
  public.current_user_is_admin()
  or public.current_user_can('sales','view') or public.current_user_can('clients','view')
  or public.current_user_can('accounting_onboarding','view'));
create policy deal_payment_lines_write on public.deal_payment_lines for all to authenticated using (
  public.current_user_is_admin() or public.current_user_can('accounting_onboarding','edit'))
  with check (public.current_user_is_admin() or public.current_user_can('accounting_onboarding','edit'));
alter publication supabase_realtime add table public.deal_payment_lines;
-- ROLLBACK:
-- alter publication supabase_realtime drop table public.deal_payment_lines;
-- drop table if exists public.deal_payment_lines cascade;
```
- [ ] **Step 4: Run, verify PASS.** (If `rls_enabled` helper is absent, assert via `select relrowsecurity from pg_class where relname='deal_payment_lines'`.)
- [ ] **Step 5: Stage.**

### Task 3: `deal_payments_with_totals` view

**Files:**
- Create: `supabase/migrations/<ts>_deal_payments_totals_view.sql`
- Test: `supabase/tests/deal_payments_totals_view_test.sql`

- [ ] **Step 1: Failing test** — view exists; for a payment with two lines (100@24, 200@24) totals are net=300, gross=372.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration**
```sql
create or replace view public.deal_payments_with_totals
with (security_invoker = true) as
select p.*,
  coalesce(sum(l.amount_net), p.amount_net, 0)   as total_net,
  coalesce(sum(l.vat_amount), 0)                 as total_vat,
  coalesce(sum(l.amount_gross), p.amount_gross, 0) as total_gross,
  count(l.id)                                    as line_count
from public.deal_payments p
left join public.deal_payment_lines l on l.payment_id = p.id
group by p.id;
-- ROLLBACK: drop view if exists public.deal_payments_with_totals;
```
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

---

## Phase 2 — Backfill (parity with current behavior)

### Task 4: Backfill job billing fields

**Files:** Create `supabase/migrations/<ts>_backfill_jobs_billing.sql`; Test `supabase/tests/backfill_jobs_billing_test.sql`

- [ ] **Step 1: Failing test** — after backfill, every non-archived job has non-null `title` and `amount_net`; a recurring_monthly job's `amount_net` == its `monthly_amount`; a one_time job's `amount_net` == its `one_time_amount`.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration**
```sql
update public.jobs set
  amount_net = coalesce(amount_net,
    case when billing_type = 'one_time' then one_time_amount else monthly_amount end, 0),
  title = coalesce(nullif(title,''),
    initcap(replace(service_type,'_',' '))),
  vat_rate = coalesce(vat_rate, 24.00)
where amount_net is null or title is null;
-- ROLLBACK: (irreversible content backfill; safe to leave — columns are new/nullable)
```
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

### Task 5: Backfill payment lines (header + one line each)

**Files:** Create `supabase/migrations/<ts>_backfill_payment_lines.sql`; Test `supabase/tests/backfill_payment_lines_test.sql`

- [ ] **Step 1: Failing test (parity)** — for every existing `deal_payments` row, exactly one `deal_payment_lines` row exists and `deal_payments_with_totals.total_gross == old deal_payments.amount_gross` (±0.01).
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration**
```sql
-- One line per existing payment; resolve job_id by matching service_type on the same deal.
insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
select p.id,
       (select j.id from public.jobs j
         where j.deal_id = p.deal_id and j.service_type = p.service_type and not j.archived
         order by j.created_at limit 1),
       coalesce(p.label, p.service_type),
       p.amount_net, p.vat_rate
from public.deal_payments p
where not exists (select 1 from public.deal_payment_lines l where l.payment_id = p.id);
-- ROLLBACK: delete from public.deal_payment_lines l using public.deal_payments p
--   where l.payment_id = p.id;   -- (only safe pre-cutover)
```
- [ ] **Step 4: Run, verify PASS (parity holds).**
- [ ] **Step 5: Stage.**

---

## Phase 3 — Generation + RPCs

### Task 6: `generate_payments_for_deal(deal_id)`

**Files:** Create `supabase/migrations/<ts>_generate_payments_for_deal.sql`; Test `supabase/tests/generate_payments_for_deal_test.sql`

- [ ] **Step 1: Failing test** — given a deal with (a) a recurring_monthly job €500@24 and (b) a one_time web_dev job €1000 terms 50_50: calling the fn produces a recurring header (1 line, gross 620) and two installment headers (gross 620 each); grouped jobs (same `billing_group_id`) produce ONE header with 2 lines.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration** — implement `generate_payments_for_deal(target_deal_id uuid)` (SECURITY DEFINER): idempotent (skip jobs that already have a current-period line); for each active job, create header(s)+line(s): one_time (+ web_dev `payment_terms` split via the deal's services_planned terms, + setup_fee line); recurring first period (`end_date = start + 1 month/1 year`); jobs sharing `billing_group_id` + cadence → one header, one line each. Use net-basis + country VAT. Full SQL written in the migration (mirrors `seed_deal_payments` in `20260617000004` but reads jobs and writes header+lines).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

### Task 7: `create_custom_job` RPC

**Files:** Create `supabase/migrations/<ts>_job_billing_rpcs.sql` (this + Tasks 8–9 share the file); Test `supabase/tests/create_custom_job_test.sql`

- [ ] **Step 1: Failing test** — a non-accounting, non-admin caller → `{ok:false, errors:['permission_denied']}`; an accounting caller creating a recurring_monthly billing-only job → a job row with `is_custom=true, billing_only=true, status='active'` and at least one generated payment line.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration**
```sql
create or replace function public.create_custom_job(
  p_deal_id uuid, p_title text, p_description text, p_department text,
  p_billing_type text, p_amount_net numeric, p_vat_rate numeric,
  p_setup_fee numeric default 0, p_billing_only boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.deals; v_job_id uuid; v_group uuid; v_stage uuid; v_owner uuid;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  select * into d from public.deals where id = p_deal_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['deal_not_found']); end if;
  if coalesce(trim(p_title),'') = '' then return jsonb_build_object('ok', false, 'errors', array['title_required']); end if;
  if p_billing_type not in ('one_time','recurring_monthly','recurring_yearly')
    then return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;
  if not p_billing_only then
    select id into v_stage from public.pipeline_stages
      where board = case when p_department='ai_seo' then 'web_seo' else p_department end
        and not archived order by position limit 1;
    v_owner := public.team_lead_for_group(p_department);
  end if;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
      setup_fee, title, description, is_custom, billing_only, billing_active, status, stage_id,
      assigned_group_id, owner_user_id, started_at, code)
    values (d.id, d.client_id, p_department, p_billing_type, p_amount_net, coalesce(p_vat_rate,24),
      coalesce(p_setup_fee,0), trim(p_title), p_description, true, p_billing_only, true, 'active', v_stage,
      (select id from public.groups where code = p_department), v_owner, now(), d.code)
    returning id into v_job_id;
  perform public.generate_payments_for_deal(d.id);
  return jsonb_build_object('ok', true, 'job_id', v_job_id);
end $$;
grant execute on function public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean) to authenticated;
-- ROLLBACK: drop function if exists public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean);
```
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

### Task 8: `update_job_billing` RPC
**Files:** modify `<ts>_job_billing_rpcs.sql`; Test `supabase/tests/update_job_billing_test.sql`
- [ ] **Step 1: Failing test** — accounting updates a job's `amount_net` and `billing_group_id`; the job reflects it; an already-`paid` payment line is unchanged.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration** — `update_job_billing(p_job_id, p_title, p_description, p_amount_net, p_vat_rate, p_billing_type, p_billing_group_id)` SECURITY DEFINER, same gate; updates only the job row (future generation picks up new values; does not touch issued/paid payments); returns `{ok, job_id}`. Grant to authenticated. Rollback drops fn.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

### Task 9: `end_job` RPC
**Files:** modify `<ts>_job_billing_rpcs.sql`; Test `supabase/tests/end_job_test.sql`
- [ ] **Step 1: Failing test** — after `end_job`, job `billing_active=false`; a subsequent `ensure_recurring_payments` creates no new period for it.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration** — `end_job(p_job_id)` SECURITY DEFINER, same gate; sets `billing_active=false` (and `status='completed'`, `completed_at=now()` if not already terminal); returns `{ok, job_id}`. Grant + rollback.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

### Task 10: Job-driven `ensure_recurring_payments`
**Files:** Create `supabase/migrations/<ts>_ensure_recurring_payments_jobs.sql`; Test `supabase/tests/ensure_recurring_payments_jobs_test.sql`
- [ ] **Step 1: Failing test** — a recurring job whose latest line ends within 7 days and is `billing_active` gets a next-period header+line; a `billing_active=false` job does not; grouped jobs renew as one combined header.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration** — rename current fn to `ensure_recurring_payments_legacy`; create new `ensure_recurring_payments()` that iterates active recurring jobs (deal not archived, `billing_active`), groups by `billing_group_id`, and for each group whose current line's `end_date <= current_date + 7` with no successor, inserts the next header+lines (advance 1 month/1 year, copy `amount_net`/`vat_rate`). Cron already calls `ensure_recurring_payments` (unchanged name). Rollback re-points to `_legacy`.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

---

## Phase 4 — Spawn cutover

### Task 11: Point spawn at job-driven generation
**Files:** Create `supabase/migrations/<ts>_spawn_cutover.sql`; Test `supabase/tests/spawn_cutover_test.sql`
- [ ] **Step 1: Failing test** — inserting a deal with `services_planned` results in jobs carrying `amount_net`, and `generate_payments_for_deal` having produced header+lines (no rows created by the old `seed_deal_payments` path).
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Migration** — update `release_jobs_for_deal` to set `amount_net`/`vat_rate`/`title` on spawned jobs; replace the `deals_seed_payments` trigger body to call `release_jobs_for_deal(deal, false)` then `generate_payments_for_deal(deal)` (instead of the old `seed_deal_payments`); keep `seed_deal_payments` defined but unused (fallback). `services_planned` remains the sales record. Rollback restores the old trigger.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

---

## Phase 5 — Frontend ("Jobs & Billing" panel)

### Task 12: Data hooks
**Files:** Create `src/features/deals/hooks/useJobsBilling.ts`, `src/features/deals/hooks/useCustomJobMutations.ts`; Tests alongside.
- [ ] **Step 1: Failing test** — `useJobsBilling(dealId)` returns jobs joined with their payment lines via `deal_payments_with_totals` + `deal_payment_lines`; `useCustomJobMutations` exposes `createCustomJob/updateJobBilling/endJob` calling the RPCs and invalidating `['jobs-billing', dealId]`.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** the hooks (TanStack Query; RPC wrappers in `src/lib/rpc.ts`: `createCustomJob`, `updateJobBilling`, `endJob`).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

### Task 13: `AddCustomJobForm`
**Files:** Create `src/features/deals/AddCustomJobForm.tsx` + test.
- [ ] **Step 1: Failing test** — renders fields (title, department incl. "Billing-only", price net, VAT, cadence, optional description + setup fee); submit disabled until title + price set; submit calls `createCustomJob` with the entered values.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** the form (shadcn `Select`/`Input`, i18n EN/EL keys under `deals:jobs_billing.*`).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

### Task 14: `JobsBillingPanel` (+ line-aware payments)
**Files:** Create `src/features/deals/JobsBillingPanel.tsx` + test; modify `src/features/deals/PaymentsPanel.tsx` to read from `deal_payments_with_totals` and render lines.
- [ ] **Step 1: Failing test** — panel lists each job (title, department, price+cadence, next payment, status) with Edit price, End, and a "Bill together/separately" control; shows combined payments as one row with multiple lines; "+ Add job" opens `AddCustomJobForm`.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** the panel + adapt PaymentsPanel/PaymentRow to lines + totals view.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Stage.**

### Task 15: Wire into the deal page
**Files:** Modify `src/features/deals/DealDetailPage.tsx`.
- [ ] **Step 1: Failing test** — for an accounting user the deal page shows the "Jobs & Billing" panel (merging the Payment + Jobs views); for others, unchanged.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — mount `JobsBillingPanel` in the Payment/Jobs area when the user is admin or accounting.
- [ ] **Step 4: Run, verify PASS + full suite (`npm test`, `npm run typecheck`, `npm run lint`).**
- [ ] **Step 5: Stage. Then DEMO on localhost.**

---

## Self-review notes
- **Spec coverage:** jobs-own-billing (T1,4,11), payments-from-jobs (T2,3,5,6,11), together/separate (T2 lines + T6/T10 billing_group + T14 control), custom jobs (T7,13,14), stay-as-jobs/deal-associated (T7,11,15), accounting ease (T13,14,15), recurring-per-job (T10), permissions (T2 RLS, T7–9 RPCs), migration/parity (T4,5 + totals view), testing (pgTAP per task + Vitest). All spec sections mapped.
- **Type consistency:** RPC names `create_custom_job`/`update_job_billing`/`end_job`, generation `generate_payments_for_deal`, view `deal_payments_with_totals`, columns `amount_net`/`vat_rate`/`billing_active`/`billing_only`/`billing_group_id`, table `deal_payment_lines` — used consistently across tasks.
- **Cutover safety:** old columns + `seed_deal_payments` + `ensure_recurring_payments_legacy` retained for fallback; all rollback SQL inline.
