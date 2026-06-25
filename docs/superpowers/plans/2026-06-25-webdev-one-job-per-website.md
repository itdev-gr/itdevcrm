# Web Dev: One Job Per Website (custom payment schedule + duplicate guardrail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Web Dev job represents one website (never one payment). A single web_dev job can carry any payment shape — full, 50/50, 50/25/25, or a **custom** schedule of arbitrary amounts/dates — and accounting is steered to one web_dev card per website by a confirm-required guardrail.

**Architecture:** Add a nullable `jobs.installment_schedule` JSONB holding the custom parts. The existing payment generator (`generate_payments_for_deal`) gains a `custom` branch that emits one `deal_payment` per schedule row; the two RPCs (`create_custom_job`, `update_job_billing`) accept/validate the schedule. A new `web_dev_job_exists` error from `create_custom_job` (overridable with `p_force`) backs a frontend confirm dialog. Existing duplicate jobs are consolidated in a final, human-confirmed cleanup phase.

**Tech Stack:** Supabase Postgres (plpgsql, SECURITY DEFINER RPCs), React + TypeScript, react-query, vitest, react-i18next (en/el). Prod DDL is applied via the Supabase MCP `apply_migration` (Bash/psql is safety-blocked); migration files still live in `supabase/migrations/`.

**Key facts established during investigation:**
- No code path splits a job per payment. `create_custom_job` makes ONE job; `release_jobs_for_deal` / `release_billing_jobs_for_deal` make one job per *service* and are idempotent. The duplicates are created manually by accounting.
- `generate_payments_for_deal` is idempotent via `not exists (deal_payment_lines …)` guards. The web_dev installment block emits one payment per installment (only the first dated); other jobs go through a grouped block; setup fees get their own payment.
- `update_job_billing` already regenerates payments when the plan/amount/billing_type changes, unless an installment is already `paid`/invoiced (`cannot_replan_paid_installment`).
- `installment_plan` today is `'none' | '50_50' | '50_25_25'` (web_dev one-time only). We add `'custom'`.

---

## File Structure

- **Migration (new):** `supabase/migrations/20260625120000_webdev_custom_payment_schedule.sql` — adds the column and replaces the three functions. Single migration so the schema + all three functions stay consistent.
- **`src/features/deals/customSchedule.ts` (new):** pure schedule type + validator (`validateCustomSchedule`). One responsibility: schedule math/validation, unit-tested.
- **`src/features/deals/customSchedule.test.ts` (new):** tests for the validator.
- **`src/lib/rpc.ts` (modify):** widen `InstallmentPlan`, extend `CreateCustomJobInput` (+`installmentSchedule`, `+force`) and `UpdateJobBillingInput` (+`installmentSchedule`); pass the new params.
- **`src/features/deals/installmentSplit.ts` (modify):** widen `InstallmentPlan` type to include `'custom'` (ratios map unchanged; `'custom'` is never ratio-split).
- **`src/features/deals/CustomScheduleEditor.tsx` (new):** small controlled editor (rows of amount + optional date, add/remove, live total-vs-target check). Reused by the add form and the inline row editor.
- **`src/features/deals/AddCustomJobForm.tsx` (modify):** add the `custom` plan option + editor; duplicate-confirm dialog on `web_dev_job_exists`.
- **`src/features/deals/JobsBillingPanel.tsx` (modify):** add `custom` to the inline plan dropdown; open the editor to edit an existing job's schedule.
- **`src/features/deals/hooks/useCustomJobMutations.ts` (modify):** thread `force` / `installmentSchedule` through the create/update mutations.
- **`src/i18n/locales/en/deals.json` + `src/i18n/locales/el/deals.json` (modify):** new `jobs_billing` keys (custom plan label, schedule editor strings, new billing_errors).

---

## PHASE 1 — Backend: custom schedule + guardrail

### Task 1: Migration — column + three function replacements

**Files:**
- Create: `supabase/migrations/20260625120000_webdev_custom_payment_schedule.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260625120000_webdev_custom_payment_schedule.sql` with the full content below. (The AI SEO trio block inside `create_custom_job` is copied verbatim from the current definition — do not alter it.)

```sql
-- Web Dev: one job per website. Adds a custom payment schedule (arbitrary
-- amounts/dates on ONE job) + a confirm-required guardrail against a second
-- web_dev job on the same deal.
--
-- ROLLBACK (manual): 
--   alter table public.jobs drop column if exists installment_schedule;
--   then restore the prior bodies of create_custom_job / update_job_billing /
--   generate_payments_for_deal from migration history (the 'custom' branch and
--   p_force / p_installment_schedule params must be dropped to match callers).

alter table public.jobs add column if not exists installment_schedule jsonb;

-- 1) create_custom_job: + p_installment_schedule, + p_force, + 'custom' plan, + guardrail
create or replace function public.create_custom_job(
  p_deal_id uuid, p_title text, p_description text, p_department text,
  p_billing_type text, p_amount_net numeric, p_vat_rate numeric,
  p_setup_fee numeric default 0, p_billing_only boolean default false,
  p_installment_plan text default 'none',
  p_installment_schedule jsonb default null,
  p_force boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare d public.deals; v_job_id uuid; v_stage uuid; v_owner uuid; v_service text; v_group uuid;
        v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid;
        v_sched jsonb; v_sched_sum numeric;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  select * into d from public.deals where id = p_deal_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['deal_not_found']); end if;
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('ok', false, 'errors', array['title_required']); end if;
  if p_billing_type not in ('one_time','recurring_monthly','recurring_yearly') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;
  if coalesce(p_installment_plan, 'none') not in ('none','50_50','50_25_25','custom') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_installment_plan']); end if;
  if coalesce(p_installment_plan, 'none') <> 'none'
     and not (p_department = 'web_dev' and not p_billing_only and p_billing_type = 'one_time') then
    return jsonb_build_object('ok', false, 'errors', array['installment_plan_web_dev_one_time_only']); end if;

  -- Guardrail: one Web Dev job per website. A genuinely separate website/add-on
  -- needs p_force = true (driven by a frontend confirm).
  if p_department = 'web_dev' and not p_billing_only and not coalesce(p_force, false)
     and exists (select 1 from public.jobs
                  where deal_id = d.id and service_type = 'web_dev' and not archived) then
    return jsonb_build_object('ok', false, 'errors', array['web_dev_job_exists']);
  end if;

  -- Custom schedule: must be a non-empty array whose parts sum to the total.
  v_sched := null;
  if coalesce(p_installment_plan,'none') = 'custom' then
    if p_installment_schedule is null or jsonb_typeof(p_installment_schedule) <> 'array'
       or jsonb_array_length(p_installment_schedule) = 0 then
      return jsonb_build_object('ok', false, 'errors', array['schedule_required']); end if;
    select coalesce(sum((e->>'amount_net')::numeric), 0) into v_sched_sum
      from jsonb_array_elements(p_installment_schedule) e;
    if round(v_sched_sum, 2) <> round(coalesce(p_amount_net,0), 2) then
      return jsonb_build_object('ok', false, 'errors', array['schedule_total_mismatch']); end if;
    v_sched := p_installment_schedule;
  end if;

  -- AI SEO: billing record + two work cards (VERBATIM from current definition)
  if p_department = 'ai_seo' and not p_billing_only then
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, setup_fee,
        title, description, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        owner_user_id, started_at, code, installment_plan)
      values (d.id, d.client_id, 'ai_seo', p_billing_type, coalesce(p_amount_net,0), coalesce(p_vat_rate,24),
        coalesce(p_setup_fee,0), trim(p_title), p_description, true, true, true, 'active', null, null,
        null, now(), d.code, 'none')
      returning id into v_job_id;

    select id into v_web_stage from public.pipeline_stages where board='web_seo' and not archived order by position limit 1;
    select id into v_web_group from public.groups where code='web_seo';
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, setup_fee,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, started_at, code, installment_plan)
      values (d.id, d.client_id, 'web_seo', p_billing_type, 0, coalesce(p_vat_rate,24), 0,
        'AI SEO — Web', true, false, false, 'active', v_web_stage, v_web_group,
        v_job_id, now(), d.code, 'none');

    select id into v_local_stage from public.pipeline_stages where board='local_seo' and not archived order by position limit 1;
    select id into v_local_group from public.groups where code='local_seo';
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, setup_fee,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, started_at, code, installment_plan)
      values (d.id, d.client_id, 'local_seo', p_billing_type, 0, coalesce(p_vat_rate,24), 0,
        'AI SEO — Local', true, false, false, 'active', v_local_stage, v_local_group,
        v_job_id, now(), d.code, 'none');

    perform public.generate_payments_for_deal(d.id);
    return jsonb_build_object('ok', true, 'job_id', v_job_id);
  end if;

  -- Generic path
  if p_billing_only then
    v_service := 'other';
  else
    v_service := p_department;
    select id into v_stage from public.pipeline_stages
      where board = case when p_department = 'ai_seo' then 'web_seo' else p_department end
        and not archived order by position limit 1;
    v_owner := public.team_lead_for_group(p_department);
    select id into v_group from public.groups where code = p_department;
  end if;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, setup_fee,
      title, description, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
      owner_user_id, started_at, code, installment_plan, installment_schedule)
    values (d.id, d.client_id, v_service, p_billing_type, coalesce(p_amount_net, 0), coalesce(p_vat_rate, 24),
      coalesce(p_setup_fee, 0), trim(p_title), p_description, true, p_billing_only, true, 'active', v_stage,
      v_group, v_owner, now(), d.code, coalesce(p_installment_plan, 'none'), v_sched)
    returning id into v_job_id;

  perform public.generate_payments_for_deal(d.id);
  return jsonb_build_object('ok', true, 'job_id', v_job_id);
end $function$;

-- 2) generate_payments_for_deal: + 'custom' branch, exclude 'custom' from grouped block
create or replace function public.generate_payments_for_deal(target_deal_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date; v_end date; grp record; j record; v_payment_id uuid;
  v_total_cents int; v_alloc int; v_cents int; v_n int; v_i int; v_vat numeric; v_due date;
  elem jsonb;
begin
  select coalesce(actual_close_date, current_date) into v_start from public.deals where id = target_deal_id;
  if v_start is null then v_start := current_date; end if;

  -- Web Dev fixed installments (50_50 / 50_25_25)
  for j in
    select * from public.jobs jj
     where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
       and jj.billing_type = 'one_time' and jj.service_type = 'web_dev'
       and coalesce(jj.installment_plan, 'none') in ('50_50', '50_25_25')
       and not exists (select 1 from public.deal_payment_lines l
                        where l.job_id = jj.id and coalesce(l.label, '') <> 'Setup fee')
  loop
    v_vat := coalesce(j.vat_rate, 24);
    v_total_cents := round(coalesce(j.amount_net, 0) * 100)::int;
    v_n := case j.installment_plan when '50_25_25' then 3 else 2 end;
    v_alloc := 0;
    for v_i in 1..v_n loop
      if v_i = v_n then v_cents := v_total_cents - v_alloc;
      elsif v_i = 1 then v_cents := round(v_total_cents * 0.5)::int;
      else v_cents := round(v_total_cents * 0.25)::int; end if;
      v_alloc := v_alloc + v_cents;
      v_due := case when v_i = 1 then v_start else null end;
      insert into public.deal_payments
        (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate, label)
        values (target_deal_id, j.service_type, 'one_time', v_due, v_due, 'pending',
                v_cents / 100.0, v_vat, 'Installment ' || v_i || '/' || v_n)
        returning id into v_payment_id;
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id,
                coalesce(nullif(j.title, ''), j.service_type) || ' (' || v_i || '/' || v_n || ')',
                v_cents / 100.0, v_vat);
    end loop;
  end loop;

  -- Web Dev CUSTOM schedule: one payment per schedule row, using its own due date
  for j in
    select * from public.jobs jj
     where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
       and jj.billing_type = 'one_time' and jj.service_type = 'web_dev'
       and coalesce(jj.installment_plan, 'none') = 'custom'
       and jj.installment_schedule is not null
       and not exists (select 1 from public.deal_payment_lines l
                        where l.job_id = jj.id and coalesce(l.label, '') <> 'Setup fee')
  loop
    v_vat := coalesce(j.vat_rate, 24);
    v_n := jsonb_array_length(j.installment_schedule);
    v_i := 0;
    for elem in select * from jsonb_array_elements(j.installment_schedule) loop
      v_i := v_i + 1;
      v_due := nullif(elem->>'due_date', '')::date;
      insert into public.deal_payments
        (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate, label)
        values (target_deal_id, j.service_type, 'one_time', v_due, v_due, 'pending',
                (elem->>'amount_net')::numeric, v_vat, 'Installment ' || v_i || '/' || v_n)
        returning id into v_payment_id;
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id,
                coalesce(nullif(j.title, ''), j.service_type) || ' (' || v_i || '/' || v_n || ')',
                (elem->>'amount_net')::numeric, v_vat);
    end loop;
  end loop;

  -- Grouped billing (everything else). EXCLUDES web_dev one-time with a plan, incl. 'custom'.
  for grp in
    select coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text) as group_key, jb.billing_type
      from public.jobs jb
     where jb.deal_id = target_deal_id and not jb.archived and jb.billing_active
       and jb.billing_type in ('one_time','recurring_monthly','recurring_yearly')
       and not (jb.billing_type = 'one_time' and jb.service_type = 'web_dev'
                and coalesce(jb.installment_plan, 'none') in ('50_50', '50_25_25', 'custom'))
       and not exists (select 1 from public.deal_payment_lines l where l.job_id = jb.id)
     group by coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text), jb.billing_type
  loop
    v_end := case grp.billing_type
               when 'recurring_monthly' then (v_start + interval '1 month')::date
               when 'recurring_yearly'  then (v_start + interval '1 year')::date
               else v_start end;
    insert into public.deal_payments
      (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
      values (target_deal_id, null, grp.billing_type, v_start, v_end, 'pending', 0, 24)
      returning id into v_payment_id;
    for j in
      select * from public.jobs jj
       where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
         and jj.billing_type = grp.billing_type
         and coalesce(jj.billing_group_id::text, 'solo:' || jj.id::text) = grp.group_key
         and not (jj.billing_type = 'one_time' and jj.service_type = 'web_dev'
                  and coalesce(jj.installment_plan, 'none') in ('50_50', '50_25_25', 'custom'))
         and not exists (select 1 from public.deal_payment_lines l where l.job_id = jj.id)
    loop
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id, coalesce(nullif(j.title, ''), j.service_type),
                coalesce(j.amount_net, 0), coalesce(j.vat_rate, 24));
    end loop;
    update public.deal_payments p set
      amount_net = coalesce((select sum(amount_net) from public.deal_payment_lines where payment_id = p.id), 0),
      vat_rate   = coalesce((select max(vat_rate)  from public.deal_payment_lines where payment_id = p.id), 24),
      service_type = (select case when count(distinct j2.service_type) filter (where j2.service_type is not null) = 1
                                  then max(j2.service_type) else null end
                      from public.deal_payment_lines l join public.jobs j2 on j2.id = l.job_id
                      where l.payment_id = p.id)
     where p.id = v_payment_id;
  end loop;

  -- Setup fees (unchanged)
  for j in
    select * from public.jobs jj
     where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
       and coalesce(jj.setup_fee, 0) > 0
       and not exists (select 1 from public.deal_payment_lines l
                        where l.job_id = jj.id and l.label = 'Setup fee')
  loop
    insert into public.deal_payments
      (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
      values (target_deal_id, j.service_type, 'one_time', v_start, v_start, 'pending', j.setup_fee, coalesce(j.vat_rate, 24))
      returning id into v_payment_id;
    insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
      values (v_payment_id, j.id, 'Setup fee', j.setup_fee, coalesce(j.vat_rate, 24));
  end loop;
end $function$;

-- 3) update_job_billing: + p_installment_schedule, + 'custom' plan, regen on schedule change
create or replace function public.update_job_billing(
  p_job_id uuid, p_title text default null, p_description text default null,
  p_amount_net numeric default null, p_vat_rate numeric default null,
  p_billing_type text default null, p_billing_group_id uuid default null,
  p_clear_group boolean default false, p_installment_plan text default null,
  p_installment_schedule jsonb default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job public.jobs;
  v_new_billing text; v_new_amount numeric; v_new_plan text;
  v_new_sched jsonb; v_sched_sum numeric; v_regen boolean := false;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  if p_billing_type is not null and p_billing_type not in ('one_time','recurring_monthly','recurring_yearly') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;
  if p_installment_plan is not null and p_installment_plan not in ('none','50_50','50_25_25','custom') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_installment_plan']); end if;

  select * into v_job from public.jobs where id = p_job_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['job_not_found']); end if;

  v_new_billing := coalesce(p_billing_type, v_job.billing_type);
  v_new_amount  := coalesce(p_amount_net, v_job.amount_net);
  v_new_plan    := coalesce(p_installment_plan, v_job.installment_plan, 'none');
  if not (v_job.service_type = 'web_dev' and v_new_billing = 'one_time') then
    v_new_plan := 'none';
  end if;
  if coalesce(p_installment_plan, 'none') <> 'none'
     and not (v_job.service_type = 'web_dev' and v_new_billing = 'one_time') then
    return jsonb_build_object('ok', false, 'errors', array['installment_plan_web_dev_one_time_only']); end if;

  -- Resolve the schedule for a custom plan; validate it sums to the new amount.
  if v_new_plan = 'custom' then
    v_new_sched := coalesce(p_installment_schedule, v_job.installment_schedule);
    if v_new_sched is null or jsonb_typeof(v_new_sched) <> 'array' or jsonb_array_length(v_new_sched) = 0 then
      return jsonb_build_object('ok', false, 'errors', array['schedule_required']); end if;
    select coalesce(sum((e->>'amount_net')::numeric), 0) into v_sched_sum
      from jsonb_array_elements(v_new_sched) e;
    if round(v_sched_sum, 2) <> round(coalesce(v_new_amount,0), 2) then
      return jsonb_build_object('ok', false, 'errors', array['schedule_total_mismatch']); end if;
  else
    v_new_sched := null;
  end if;

  v_regen := (coalesce(v_new_plan, 'none') <> 'none' or coalesce(v_job.installment_plan, 'none') <> 'none')
             and (v_new_amount is distinct from v_job.amount_net
                  or coalesce(v_new_plan, 'none') is distinct from coalesce(v_job.installment_plan, 'none')
                  or v_new_billing is distinct from v_job.billing_type
                  or (v_new_plan = 'custom' and p_installment_schedule is not null
                      and p_installment_schedule is distinct from v_job.installment_schedule));

  if v_regen and exists (
    select 1 from public.deal_payments p
      join public.deal_payment_lines l on l.payment_id = p.id
     where l.job_id = p_job_id and (p.status = 'paid' or p.invoice_number is not null)
  ) then
    return jsonb_build_object('ok', false, 'errors', array['cannot_replan_paid_installment']);
  end if;

  update public.jobs set
    title              = coalesce(p_title, title),
    description        = coalesce(p_description, description),
    amount_net         = coalesce(p_amount_net, amount_net),
    vat_rate           = coalesce(p_vat_rate, vat_rate),
    billing_type       = coalesce(p_billing_type, billing_type),
    installment_plan   = v_new_plan,
    installment_schedule = v_new_sched,
    billing_group_id   = case when p_clear_group then null else coalesce(p_billing_group_id, billing_group_id) end,
    updated_at         = now()
   where id = p_job_id;

  if v_regen then
    delete from public.deal_payments p
     where p.deal_id = v_job.deal_id
       and exists (select 1 from public.deal_payment_lines l where l.payment_id = p.id and l.job_id = p_job_id);
    perform public.generate_payments_for_deal(v_job.deal_id);
  end if;

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end $function$;
```

- [ ] **Step 2: Apply the migration to prod via the Supabase MCP**

Use the MCP tool `apply_migration` (project `xujlrclyzxrvxszepquy`, name `webdev_custom_payment_schedule`) with the file's SQL. (Bash/psql is blocked by the safety classifier for DDL.)

- [ ] **Step 3: Verify the column + functions exist**

Run via MCP `execute_sql`:
```sql
select column_name from information_schema.columns
where table_name='jobs' and column_name='installment_schedule';
select proname from pg_proc where proname in
  ('create_custom_job','update_job_billing','generate_payments_for_deal');
```
Expected: `installment_schedule` row present; all three function names returned.

- [ ] **Step 4: Verify the guardrail and custom schedule behave (smoke, on a throwaway deal)**

Pick a test deal with no web_dev job. Run (MCP `execute_sql`):
```sql
-- a) guardrail off by default after first job
select public.create_custom_job('<TEST_DEAL>', 'Website', null, 'web_dev', 'one_time', 1000, 24, 0, false, 'custom',
  '[{"amount_net":400,"due_date":"2026-07-01"},{"amount_net":600,"due_date":"2026-08-01"}]'::jsonb, false);
-- expect ok:true
-- b) second web_dev without force is blocked
select public.create_custom_job('<TEST_DEAL>', 'Website 2', null, 'web_dev', 'one_time', 500, 24, 0, false, 'none', null, false);
-- expect ok:false, errors:[web_dev_job_exists]
-- c) schedule mismatch rejected
select public.create_custom_job('<TEST_DEAL>', 'W', null, 'web_dev', 'one_time', 1000, 24, 0, false, 'custom',
  '[{"amount_net":400}]'::jsonb, true);
-- expect ok:false, errors:[schedule_total_mismatch]
-- d) the custom job produced exactly 2 payments
select label, amount_net, start_date from public.deal_payments where deal_id='<TEST_DEAL>' order by label;
-- expect Installment 1/2 (€400, 2026-07-01) and Installment 2/2 (€600, 2026-08-01)
```
Then clean up the test job/payments (delete the inserted job + its payments) so the deal is left as found.

- [ ] **Step 5: Commit the migration file**

```bash
git add supabase/migrations/20260625120000_webdev_custom_payment_schedule.sql
git commit -m "feat(billing): web_dev custom payment schedule + one-job-per-website guardrail (DB)"
```

---

### Task 2: RPC client wrappers (`src/lib/rpc.ts`)

**Files:**
- Modify: `src/lib/rpc.ts:132-203`

- [ ] **Step 1: Widen the InstallmentPlan type and add the schedule type**

Replace the `InstallmentPlan` line and add a schedule row type:
```ts
/** Installment plan for one-time web_dev jobs (see features/deals/installmentSplit). */
export type InstallmentPlan = 'none' | '50_50' | '50_25_25' | 'custom';
/** One row of a custom payment schedule (web_dev one-time only). */
export type ScheduleRow = { amount_net: number; due_date: string | null };
```

- [ ] **Step 2: Extend CreateCustomJobInput + the call**

In `CreateCustomJobInput` add:
```ts
  /** Required when installmentPlan === 'custom'. Parts must sum to amountNet. */
  installmentSchedule?: ScheduleRow[] | null;
  /** Override the one-web_dev-job-per-deal guardrail. */
  force?: boolean;
```
In `createCustomJob`'s `rpcCall` args object, add:
```ts
    p_installment_schedule: input.installmentSchedule ?? null,
    p_force: input.force ?? false,
```

- [ ] **Step 3: Extend UpdateJobBillingInput + the call**

In `UpdateJobBillingInput` add:
```ts
  /** Required when installmentPlan === 'custom'; null leaves it unchanged. */
  installmentSchedule?: ScheduleRow[] | null;
```
In `updateJobBilling`'s `rpcCall` args object, add:
```ts
    p_installment_schedule: input.installmentSchedule ?? null,
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS (tsc + lint + vite).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rpc.ts
git commit -m "feat(billing): rpc wrappers accept custom schedule + force flag"
```

---

## PHASE 2 — Frontend: schedule editor + guardrail UI

### Task 3: Pure schedule validator (TDD)

**Files:**
- Create: `src/features/deals/customSchedule.ts`
- Test: `src/features/deals/customSchedule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/deals/customSchedule.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateCustomSchedule, scheduleTotal, type ScheduleRow } from './customSchedule';

const rows = (xs: Array<[number, string | null]>): ScheduleRow[] =>
  xs.map(([amount_net, due_date]) => ({ amount_net, due_date }));

describe('scheduleTotal', () => {
  it('sums the parts to cents precision', () => {
    expect(scheduleTotal(rows([[400, null], [600.5, null]]))).toBe(1000.5);
  });
});

describe('validateCustomSchedule', () => {
  it('passes when non-empty and parts sum to the target', () => {
    expect(validateCustomSchedule(rows([[400, '2026-07-01'], [600, null]]), 1000)).toBeNull();
  });
  it('fails when empty', () => {
    expect(validateCustomSchedule([], 1000)).toBe('schedule_required');
  });
  it('fails when a part is zero or negative', () => {
    expect(validateCustomSchedule(rows([[0, null], [1000, null]]), 1000)).toBe('schedule_amount_positive');
  });
  it('fails when the parts do not sum to the target', () => {
    expect(validateCustomSchedule(rows([[400, null], [500, null]]), 1000)).toBe('schedule_total_mismatch');
  });
  it('tolerates sub-cent float drift', () => {
    expect(validateCustomSchedule(rows([[333.33, null], [333.33, null], [333.34, null]]), 1000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/deals/customSchedule.test.ts`
Expected: FAIL — cannot resolve `./customSchedule`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/features/deals/customSchedule.ts`:
```ts
/** One row of a custom payment schedule for a one-time web_dev job. */
export type ScheduleRow = { amount_net: number; due_date: string | null };

/** Sum of the parts, rounded to cents (avoids float drift in the UI total). */
export function scheduleTotal(rows: ScheduleRow[]): number {
  const cents = rows.reduce((acc, r) => acc + Math.round((r.amount_net || 0) * 100), 0);
  return cents / 100;
}

/**
 * Validate a custom schedule against the job total. Returns null when valid,
 * else an error code matching the server (schedule_required /
 * schedule_amount_positive / schedule_total_mismatch).
 */
export function validateCustomSchedule(rows: ScheduleRow[], total: number): string | null {
  if (rows.length === 0) return 'schedule_required';
  if (rows.some((r) => !(r.amount_net > 0))) return 'schedule_amount_positive';
  if (Math.round(scheduleTotal(rows) * 100) !== Math.round((total || 0) * 100)) {
    return 'schedule_total_mismatch';
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/deals/customSchedule.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/deals/customSchedule.ts src/features/deals/customSchedule.test.ts
git commit -m "feat(billing): custom payment schedule validator"
```

---

### Task 4: Widen the installmentSplit type

**Files:**
- Modify: `src/features/deals/installmentSplit.ts:2`

- [ ] **Step 1: Add 'custom' to the type**

Change:
```ts
export type InstallmentPlan = 'none' | '50_50' | '50_25_25';
```
to:
```ts
export type InstallmentPlan = 'none' | '50_50' | '50_25_25' | 'custom';
```
(`RATIOS` is intentionally left without a `custom` entry; `splitInstallments`/`planCount` are never called for `custom` — the editor supplies amounts directly. Guard callers in Tasks 5–6 with `plan !== 'custom'`.)

- [ ] **Step 2: Verify existing installment tests still pass**

Run: `npx vitest run src/features/deals/installmentSplit.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/features/deals/installmentSplit.ts
git commit -m "chore(billing): allow 'custom' installment plan in type"
```

---

### Task 5: CustomScheduleEditor component

**Files:**
- Create: `src/features/deals/CustomScheduleEditor.tsx`

- [ ] **Step 1: Create the editor**

Create `src/features/deals/CustomScheduleEditor.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatEur } from '@/lib/countries';
import { scheduleTotal, validateCustomSchedule, type ScheduleRow } from './customSchedule';

type Props = {
  rows: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
  /** The job total the parts must sum to. */
  total: number;
};

export function CustomScheduleEditor({ rows, onChange, total }: Props) {
  const { t } = useTranslation('deals');
  const sum = scheduleTotal(rows);
  const error = validateCustomSchedule(rows, total);

  function update(i: number, patch: Partial<ScheduleRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    onChange([...rows, { amount_net: 0, due_date: null }]);
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="col-span-2 space-y-1.5 rounded-md border bg-background p-2 sm:col-span-3">
      <Label className="text-xs">{t('jobs_billing.schedule.label')}</Label>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-5 text-[10px] text-muted-foreground">{i + 1}.</span>
          <span className="text-[11px] text-muted-foreground">€</span>
          <Input
            type="number" step="0.01" min="0"
            value={r.amount_net ? String(r.amount_net) : ''}
            onChange={(e) => update(i, { amount_net: Number(e.target.value || 0) })}
            className="h-7 w-24 text-[11px]"
            aria-label={t('jobs_billing.schedule.amount')}
          />
          <Input
            type="date"
            value={r.due_date ?? ''}
            onChange={(e) => update(i, { due_date: e.target.value || null })}
            className="h-7 w-36 text-[11px]"
            aria-label={t('jobs_billing.schedule.due_date')}
          />
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
            onClick={() => removeRow(i)} disabled={rows.length <= 1}>
            ✕
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={addRow}>
          {t('jobs_billing.schedule.add_payment')}
        </Button>
        <span className={`text-[10px] ${error ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
          {t('jobs_billing.schedule.running_total', { sum: formatEur(sum), total: formatEur(total) })}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (component compiles; i18n keys added in Task 8 — build does not check key existence, so this passes now).

- [ ] **Step 3: Commit**

```bash
git add src/features/deals/CustomScheduleEditor.tsx
git commit -m "feat(billing): custom schedule editor component"
```

---

### Task 6: AddCustomJobForm — custom plan + guardrail confirm

**Files:**
- Modify: `src/features/deals/AddCustomJobForm.tsx`
- Modify: `src/features/deals/hooks/useCustomJobMutations.ts`

- [ ] **Step 1: Thread `force` + `installmentSchedule` through the create mutation**

In `useCustomJobMutations.ts`, the `useCreateCustomJob` mutation already spreads `input` into `createCustomJob`. Confirm its generic input type is `Omit<CreateCustomJobInput, 'dealId'>` (it is). No change needed beyond Task 2's type widening — `force` and `installmentSchedule` now flow through. (Leave a comment noting they are honored.)

- [ ] **Step 2: Add 'custom' to PLANS and a schedule state in AddCustomJobForm**

In `AddCustomJobForm.tsx`:
- Change `const PLANS: InstallmentPlan[] = ['none', '50_50', '50_25_25'];` to include `'custom'`.
- Add imports:
```tsx
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CustomScheduleEditor } from './CustomScheduleEditor';
import { validateCustomSchedule, type ScheduleRow } from './customSchedule';
```
- Add state:
```tsx
const [schedule, setSchedule] = useState<ScheduleRow[]>([{ amount_net: 0, due_date: null }]);
const [dupConfirm, setDupConfirm] = useState(false);
```

- [ ] **Step 3: Build the submit with guardrail-confirm + schedule**

Replace the `submit` function body so it (a) blocks invalid custom schedules, (b) sends the schedule when `custom`, and (c) on `web_dev_job_exists` opens a confirm that resubmits with `force: true`:
```tsx
async function doCreate(force: boolean) {
  const billingOnly = department === BILLING_ONLY;
  const isCustom = effectivePlan === 'custom';
  if (isCustom) {
    const err = validateCustomSchedule(schedule, Number(priceNet || 0));
    if (err) { alert(t(`jobs_billing.billing_errors.${err}`, { defaultValue: err })); return; }
  }
  await create.mutateAsync({
    title: title.trim(),
    description: description.trim() || null,
    department: billingOnly ? 'web_dev' : department,
    billingType: cadence,
    amountNet: Number(priceNet),
    vatRate: Number(vatRate || 0),
    setupFee: setupFee ? Number(setupFee) : 0,
    billingOnly,
    installmentPlan: effectivePlan,
    installmentSchedule: isCustom ? schedule : null,
    force,
  });
}

async function submit() {
  if (!canSubmit) return;
  try {
    await doCreate(false);
    resetForm();
    onDone?.();
  } catch (err) {
    const code = (err as Error & { errors?: string[] }).errors?.[0] ?? (err as Error).message;
    if (code === 'web_dev_job_exists') { setDupConfirm(true); return; }
    alert(t(`jobs_billing.billing_errors.${code}`, { defaultValue: code }));
  }
}

function resetForm() {
  setTitle(''); setPriceNet(''); setVatRate(String(defaultVatRate));
  setCadence('one_time'); setPlan('none'); setDescription(''); setSetupFee('');
  setSchedule([{ amount_net: 0, due_date: null }]);
}
```
(Remove the old inline `submit` body that called `create.mutateAsync` directly.)

- [ ] **Step 4: Render the editor (when custom) + the confirm dialog**

After the existing `{planEligible && (... plan select ...)}` block, add:
```tsx
{planEligible && effectivePlan === 'custom' && (
  <CustomScheduleEditor rows={schedule} onChange={setSchedule} total={Number(priceNet || 0)} />
)}
```
Before the closing `</div>` of the form, add:
```tsx
<ConfirmDialog
  open={dupConfirm}
  onOpenChange={setDupConfirm}
  title={t('jobs_billing.dup_confirm.title')}
  description={t('jobs_billing.dup_confirm.body')}
  confirmLabel={t('jobs_billing.dup_confirm.confirm')}
  onConfirm={async () => {
    try { await doCreate(true); resetForm(); setDupConfirm(false); onDone?.(); }
    catch (err) {
      const code = (err as Error & { errors?: string[] }).errors?.[0] ?? (err as Error).message;
      alert(t(`jobs_billing.billing_errors.${code}`, { defaultValue: code }));
    }
  }}
/>
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/deals/AddCustomJobForm.tsx src/features/deals/hooks/useCustomJobMutations.ts
git commit -m "feat(billing): add-job form supports custom schedule + duplicate confirm"
```

---

### Task 7: JobsBillingPanel — edit a job's custom schedule inline

**Files:**
- Modify: `src/features/deals/JobsBillingPanel.tsx`

- [ ] **Step 1: Add 'custom' to inline PLANS + a schedule editor on plan change**

In `JobsBillingPanel.tsx`:
- Change `const PLANS: InstallmentPlan[] = ['none', '50_50', '50_25_25'];` to include `'custom'`.
- Import `CustomScheduleEditor` and `validateCustomSchedule, type ScheduleRow` and `useState` (already imported).
- In `JobRow`, add state `const [editingSchedule, setEditingSchedule] = useState<ScheduleRow[] | null>(null);`.
- In `onPlanChange`, when the chosen value is `'custom'`, do NOT call the mutation yet — open the editor seeded from the job's existing schedule or a single full-amount row:
```tsx
async function onPlanChange(value: string) {
  if (value === currentPlan) return;
  if (value === 'custom') {
    setEditingSchedule([{ amount_net: Number(job.amount_net ?? 0), due_date: null }]);
    return;
  }
  try {
    await update.mutateAsync({ jobId: job.id, installmentPlan: value as InstallmentPlan });
  } catch (err) {
    const code = (err as Error & { errors?: string[] }).errors?.[0] ?? (err as Error).message;
    alert(t(`jobs_billing.billing_errors.${code}`, { defaultValue: code }));
  }
}
async function saveSchedule() {
  if (!editingSchedule) return;
  const err = validateCustomSchedule(editingSchedule, Number(job.amount_net ?? 0));
  if (err) { alert(t(`jobs_billing.billing_errors.${err}`, { defaultValue: err })); return; }
  try {
    await update.mutateAsync({ jobId: job.id, installmentPlan: 'custom', installmentSchedule: editingSchedule });
    setEditingSchedule(null);
  } catch (e) {
    const code = (e as Error & { errors?: string[] }).errors?.[0] ?? (e as Error).message;
    alert(t(`jobs_billing.billing_errors.${code}`, { defaultValue: code }));
  }
}
```

- [ ] **Step 2: Guard the plan_preview and render the editor**

The existing preview block calls `splitInstallments(... currentPlan)`. Guard it so it is skipped for `custom`:
```tsx
{planEligible && currentPlan !== 'none' && currentPlan !== 'custom' && job.amount_net != null && (
  <p className="text-[10px] text-muted-foreground">
    {t('jobs_billing.plan_preview', {
      parts: splitInstallments(Number(job.amount_net || 0), currentPlan)
        .map((n) => formatEur(n)).join(' + '),
    })}
  </p>
)}
{editingSchedule && (
  <div className="space-y-1">
    <CustomScheduleEditor rows={editingSchedule} onChange={setEditingSchedule} total={Number(job.amount_net ?? 0)} />
    <div className="flex gap-1">
      <Button type="button" size="sm" className="h-7 px-2 text-[11px]" onClick={saveSchedule} disabled={update.isPending}>
        {t('jobs_billing.schedule.save')}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setEditingSchedule(null)}>
        {t('jobs_billing.schedule.cancel')}
      </Button>
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/deals/JobsBillingPanel.tsx
git commit -m "feat(billing): edit a web_dev job's custom schedule inline"
```

---

### Task 8: i18n keys (en + el)

**Files:**
- Modify: `src/i18n/locales/en/deals.json`
- Modify: `src/i18n/locales/el/deals.json`

- [ ] **Step 1: Add the new keys under `jobs_billing` (en)**

In `src/i18n/locales/en/deals.json`, in `jobs_billing`:
- add to `plan_options`: `"custom": "Custom (choose payments)"`
- add to `billing_errors`:
```json
"web_dev_job_exists": "This deal already has a Web Dev job.",
"schedule_required": "Add at least one payment.",
"schedule_amount_positive": "Each payment must be greater than €0.",
"schedule_total_mismatch": "Payments must add up to the job price."
```
- add new blocks:
```json
"schedule": {
  "label": "Payments",
  "amount": "Amount",
  "due_date": "Due date",
  "add_payment": "+ Payment",
  "running_total": "{{sum}} of {{total}}",
  "save": "Save schedule",
  "cancel": "Cancel"
},
"dup_confirm": {
  "title": "Add a second Web Dev job?",
  "body": "This deal already has a Web Dev job. A website should be ONE job — add payments to the existing job instead. Only add another if this is a genuinely separate website/add-on.",
  "confirm": "Add anyway"
}
```

- [ ] **Step 2: Add the same keys (el) translated**

In `src/i18n/locales/el/deals.json`, in `jobs_billing`:
- `plan_options.custom`: `"Προσαρμοσμένο (επιλογή πληρωμών)"`
- `billing_errors`:
```json
"web_dev_job_exists": "Αυτή η συμφωνία έχει ήδη Web Dev εργασία.",
"schedule_required": "Προσθέστε τουλάχιστον μία πληρωμή.",
"schedule_amount_positive": "Κάθε πληρωμή πρέπει να είναι μεγαλύτερη από €0.",
"schedule_total_mismatch": "Οι πληρωμές πρέπει να αθροίζουν στην τιμή της εργασίας."
```
- `schedule`:
```json
"schedule": {
  "label": "Πληρωμές",
  "amount": "Ποσό",
  "due_date": "Ημ. πληρωμής",
  "add_payment": "+ Πληρωμή",
  "running_total": "{{sum}} από {{total}}",
  "save": "Αποθήκευση",
  "cancel": "Άκυρο"
},
"dup_confirm": {
  "title": "Προσθήκη δεύτερης Web Dev εργασίας;",
  "body": "Αυτή η συμφωνία έχει ήδη Web Dev εργασία. Μία ιστοσελίδα = ΜΙΑ εργασία — προσθέστε πληρωμές στην υπάρχουσα. Προσθέστε δεύτερη μόνο αν πρόκειται για πραγματικά ξεχωριστή ιστοσελίδα/πρόσθετο.",
  "confirm": "Προσθήκη ούτως ή άλλως"
}
```

- [ ] **Step 3: Verify build + JSON validity**

Run: `npm run build`
Expected: PASS (invalid JSON would fail the import).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json
git commit -m "i18n(billing): custom schedule + duplicate-confirm strings"
```

---

### Task 9: Live browser smoke (Playwright)

**Files:** none (verification only). Requires Phase-1 migration applied to prod and the frontend deployed (or run against local `npm run dev`).

- [ ] **Step 1: Create a custom-schedule web_dev job**

As `info@itdev.gr`, open a test deal → Jobs & billing → Add job → Department Web Dev, Cadence One-time, Plan **Custom**. Add two payments (€X + €Y summing to the price, with dates). Submit.
Expected: ONE new web_dev job appears; the Payments section shows two payments "Installment 1/2", "Installment 2/2" with the chosen dates.

- [ ] **Step 2: Trigger the guardrail**

On the same deal, Add job → Web Dev again.
Expected: the "Add a second Web Dev job?" confirm appears; cancelling adds nothing; confirming adds a second card.

- [ ] **Step 3: Edit the schedule inline**

On the custom job's row, change Plan dropdown to Custom → editor opens seeded with the total → adjust amounts to still sum to the price → Save.
Expected: payments regenerate to match; no `cannot_replan_paid_installment` (unless a payment was marked paid/invoiced).

- [ ] **Step 4: Clean up** the test job(s) so the deal is left as found.

---

## PHASE 3 — Consolidate existing duplicate Web Dev jobs (human-confirmed)

> This phase mutates production billing data. It is **case-by-case** — some same-client web_dev pairs are legitimately separate (e.g. ΜΗΤΡΟΓΙΑΝΝΗΣ "Website €2950" + "ChatGPT €97"; ΦΟΥΡΝΑΡΗ "Migration" + "Support"). Each merge is confirmed by the user before running. Take a backup first.

### Task 10: Identify and present consolidation candidates

**Files:** none (analysis via MCP `execute_sql`).

- [ ] **Step 1: Backup the affected jobs + payment rows**

```sql
create table jobs_webdev_dup_backup_20260625 as
  select * from public.jobs where service_type='web_dev' and deal_id in (
    select deal_id from public.jobs where service_type='web_dev'
    group by client_id, deal_id having count(*)>1);
create table deal_payments_webdev_dup_backup_20260625 as
  select * from public.deal_payments where deal_id in (
    select deal_id from public.jobs where service_type='web_dev'
    group by client_id, deal_id having count(*)>1);
create table deal_payment_lines_webdev_dup_backup_20260625 as
  select l.* from public.deal_payment_lines l where l.job_id in (
    select id from public.jobs where service_type='web_dev' and deal_id in (
      select deal_id from public.jobs where service_type='web_dev'
      group by client_id, deal_id having count(*)>1));
```

- [ ] **Step 2: Produce the candidate table for review**

```sql
select c.name as client, j.code, j.title, j.amount_net, j.installment_plan, s.code as stage,
       (select count(*) from public.deal_payment_lines l where l.job_id=j.id) as payment_lines,
       j.created_at
from public.jobs j join public.clients c on c.id=j.client_id
left join public.pipeline_stages s on s.id=j.stage_id
where j.service_type='web_dev' and j.deal_id in (
  select deal_id from public.jobs where service_type='web_dev'
  group by client_id, deal_id having count(*)>1)
order by c.name, j.created_at;
```
Present this to the user and label each set: **MERGE** (same website split into per-payment jobs / re-created with a different split — keep one canonical job, move all payments onto it, delete the rest) vs **KEEP BOTH** (genuinely separate jobs). Get explicit per-deal confirmation.

### Task 11: Consolidate each confirmed website (one deal at a time)

**Files:** none (MCP `execute_sql`, per confirmed deal).

- [ ] **Step 1: For a confirmed MERGE deal, choose the canonical job**

The canonical job = the one that should remain (typically the active, correctly-priced card). Set its total + a `custom` schedule that reflects ALL the real payments, then delete the redundant jobs.

For a deal where the redundant jobs were "one job per payment" (e.g. ΒΑΣΙΛΗΣ €410/€565/€700), the consolidated job's amount = sum of the real payments and its schedule = those amounts/dates:
```sql
-- EXAMPLE — fill <CANONICAL_JOB>, <DEAL>, the schedule, and <REDUNDANT_JOB_IDS>:
update public.jobs
   set amount_net = 1675,
       installment_plan = 'custom',
       installment_schedule =
         '[{"amount_net":410,"due_date":null},{"amount_net":565,"due_date":null},{"amount_net":700,"due_date":null}]'::jsonb,
       updated_at = now()
 where id = '<CANONICAL_JOB>';

-- drop the redundant jobs' payments + lines, then the jobs
delete from public.deal_payments p
 where exists (select 1 from public.deal_payment_lines l
                where l.payment_id=p.id and l.job_id = any(array['<REDUNDANT_JOB_IDS>']::uuid[]));
delete from public.deal_payment_lines where job_id = any(array['<REDUNDANT_JOB_IDS>']::uuid[]);
delete from public.jobs where id = any(array['<REDUNDANT_JOB_IDS>']::uuid[]);

-- clear the canonical job's old payment lines so generate rebuilds from the schedule
delete from public.deal_payments p
 where p.deal_id='<DEAL>' and exists (
   select 1 from public.deal_payment_lines l where l.payment_id=p.id and l.job_id='<CANONICAL_JOB>');
select public.generate_payments_for_deal('<DEAL>');
```
(For "re-created with a different split" deals like Imperial Crystals / NIOVI, the canonical job is the one WITH payment lines; the redundant one has 0 lines — just delete the redundant job, no schedule rewrite needed.)

- [ ] **Step 2: Verify the deal now has exactly one web_dev job + correct payments**

```sql
select code, amount_net, installment_plan from public.jobs
 where deal_id='<DEAL>' and service_type='web_dev' and not archived;
select label, amount_net, start_date from public.deal_payments where deal_id='<DEAL>' order by start_date nulls last, label;
```
Expected: one web_dev row; payments equal the agreed schedule.

- [ ] **Step 3: After all confirmed deals are done, spot-check the board**

Open `/tech/web-dev` and confirm the consolidated clients now show a single card each.

- [ ] **Step 4: Keep backups** (`*_webdev_dup_backup_20260625`) for rollback; drop them once the user is satisfied.

---

## Self-Review

**Spec coverage:**
- "all kinds of payments on one job" → Task 1 (custom branch + generator), Tasks 3–7 (editor/UI). ✓
- "MUST one job per website" → Task 1 guardrail (`web_dev_job_exists` + `p_force`), Task 6 confirm dialog. ✓
- "future website AND the old one" → Phase 1–2 (future) + Phase 3 (existing consolidation). ✓
- Web Dev only scope → guardrail + custom plan gated on `service_type='web_dev'` and `one_time`. ✓
- Track changes / revert → migration rollback comment (Task 1), Phase 3 backups (Task 10). ✓

**Placeholder scan:** Phase 3 SQL intentionally uses `<DEAL>` / `<CANONICAL_JOB>` placeholders because the values come from the per-deal review in Task 10 — these are runtime inputs, not unfinished plan content. All code/SQL elsewhere is complete.

**Type consistency:** `InstallmentPlan` includes `'custom'` in both `installmentSplit.ts` and `rpc.ts`; `ScheduleRow` is defined in `customSchedule.ts` and re-declared structurally in `rpc.ts` (same shape `{ amount_net, due_date }`); the server error codes (`web_dev_job_exists`, `schedule_required`, `schedule_amount_positive`, `schedule_total_mismatch`, `cannot_replan_paid_installment`) match the i18n `billing_errors` keys and the validator return values.
