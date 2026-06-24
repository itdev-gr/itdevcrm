# AI SEO 3-Row Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each AI SEO service into 3 linked job rows — a billing record (holds the price, no board) plus a €0 Web SEO work card (→pefstathiadis) and a €0 Local SEO work card (→dtzouvaras) — so each team owns its own card while billing stays in one place.

**Architecture:** Add `jobs.parent_job_id` (FK→jobs, `on delete cascade`). The AI SEO billing job (`service_type='ai_seo'`, `billing_only=true`, off-board) is the parent; two children (`web_seo`/`local_seo`, `amount_net=0`, `billing_active=false`) reference it. Both creation paths (`create_custom_job`, `release_jobs_for_deal`) emit the trio; `end_job` cascades; delete cascades via FK. A one-time backfill converts the 52 existing `ai_seo` jobs. Frontend retires the "mirror AI SEO onto the Local board" hack (each board now has a real card) and hides the €0 children from the deal Overview billing list.

**Tech Stack:** Supabase Postgres (PL/pgSQL migrations applied to prod via Supabase MCP `apply_migration`), pgTAP tests in `supabase/tests/*.sql` (run via `supabase test db`), React + TanStack Query + vitest, `npm run build` (tsc -b → eslint --max-warnings=0 → vite build).

**Spec:** `docs/superpowers/specs/2026-06-24-ai-seo-three-row-split-design.md`

**Prod project ref:** `xujlrclyzxrvxszepquy` (Supabase "CRM").

**Key IDs:** pefstathiadis@itdev.gr = `19aa9170-bd62-4319-8118-668c11e93c98`; dtzouvaras@itdev.gr = `b73d8761-cbae-4ac8-a239-878d1f2151d8`.

**Migration ordering note:** apply DB migrations in task order (filenames sort that way). Task 3 (owner trigger) must land before/with Task 4 so the billing record stays unowned. Run the Task 7 backfill **before** deploying the Task 9–11 frontend (so no board is empty in between).

**pgTAP runner:** each DB task adds a test to `supabase/tests/`. Run all with `supabase test db`. If the local stack is unavailable, run the test file's body (between `begin;` and `rollback;`) via MCP `execute_sql` against the prod ref — it rolls back, touching no data.

---

## Task 1: Schema — `jobs.parent_job_id`

**Files:**
- Create: `supabase/migrations/20260624010000_jobs_parent_job_id.sql`
- Test: `supabase/tests/jobs_parent_job_id.sql`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/jobs_parent_job_id.sql
begin;
select plan(2);

-- column exists
select has_column('public', 'jobs', 'parent_job_id', 'jobs.parent_job_id exists');

-- deleting a parent cascade-deletes its children
do $$
declare v_deal uuid; v_client uuid; v_parent uuid; v_child uuid;
begin
  select id, client_id into v_deal, v_client from public.deals limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, billing_only, billing_active)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active', true, true) returning id into v_parent;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, billing_only, billing_active, parent_job_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active', false, false, v_parent) returning id into v_child;
  perform set_config('t.child', v_child::text, true);
  delete from public.jobs where id = v_parent;
end $$;
select is(
  (select count(*)::int from public.jobs where id = current_setting('t.child')::uuid),
  0, 'deleting the parent cascade-deletes the child');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — `has_column` fails (`parent_job_id` does not exist).

- [ ] **Step 3: Write the migration**

```sql
-- 20260624010000_jobs_parent_job_id.sql
-- Link AI SEO work cards (web_seo/local_seo children) back to the AI SEO billing
-- record (parent). on delete cascade => children never outlive their billing job.
alter table public.jobs
  add column if not exists parent_job_id uuid references public.jobs(id) on delete cascade;

create index if not exists jobs_parent_job_id_idx on public.jobs (parent_job_id);

-- ROLLBACK:
--   drop index if exists public.jobs_parent_job_id_idx;
--   alter table public.jobs drop column if exists parent_job_id;
```

- [ ] **Step 4: Apply + verify**

Apply to prod via MCP `apply_migration` (name `jobs_parent_job_id`), then run `supabase test db`.
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260624010000_jobs_parent_job_id.sql supabase/tests/jobs_parent_job_id.sql
git commit -m "feat(jobs): add jobs.parent_job_id (FK cascade) for AI SEO work cards"
```

---

## Task 2: Parentage-aware job codes

Children of an `ai_seo` parent get readable codes (`…-AISEOWEB` / `…-AISEOLOC`) instead of `…-WEBSEO`/`…-LOCALSEO`.

**Files:**
- Create: `supabase/migrations/20260624020000_ai_seo_child_job_codes.sql`
- Test: `supabase/tests/ai_seo_child_job_codes.sql`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/ai_seo_child_job_codes.sql
begin;
select plan(2);
do $$
declare v_deal uuid; v_client uuid; v_code text; v_parent uuid; v_web uuid; v_local uuid;
begin
  select id, client_id, code into v_deal, v_client, v_code from public.deals where code is not null limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, billing_only, billing_active)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active', true, true) returning id into v_parent;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, billing_active, parent_job_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active', false, v_parent) returning id into v_web;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, billing_active, parent_job_id)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active', false, v_parent) returning id into v_local;
  perform set_config('t.web', v_web::text, true);
  perform set_config('t.local', v_local::text, true);
  perform set_config('t.deal_code', v_code, true);
end $$;
select is((select code from public.jobs where id = current_setting('t.web')::uuid),
  current_setting('t.deal_code') || '-AISEOWEB', 'web child code = <deal>-AISEOWEB');
select is((select code from public.jobs where id = current_setting('t.local')::uuid),
  current_setting('t.deal_code') || '-AISEOLOC', 'local child code = <deal>-AISEOLOC');
select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — codes come out `…-WEBSEO` / `…-LOCALSEO`.

- [ ] **Step 3: Write the migration**

```sql
-- 20260624020000_ai_seo_child_job_codes.sql
-- A web_seo/local_seo job that is a CHILD of an ai_seo billing record gets a
-- parentage-aware abbreviation so the code reads as AI SEO work.
create or replace function public.set_job_code() returns trigger
language plpgsql as $$
declare
  v_parent_service text;
  v_service_for_code text;
begin
  v_service_for_code := new.service_type;
  if new.parent_job_id is not null then
    select service_type into v_parent_service from public.jobs where id = new.parent_job_id;
    if v_parent_service = 'ai_seo' then
      v_service_for_code := case new.service_type
        when 'web_seo'   then 'aiseo_web'
        when 'local_seo' then 'aiseo_local'
        else new.service_type end;
    end if;
  end if;
  new.code := public.generate_job_code(new.deal_id, v_service_for_code);
  return new;
end;
$$;

create or replace function public.job_service_abbr(st text) returns text
language sql immutable as $$
  select case st
    when 'web_seo'      then 'WEBSEO'
    when 'local_seo'    then 'LOCALSEO'
    when 'web_dev'      then 'WEBDEV'
    when 'social_media' then 'SOCIAL'
    when 'hosting'      then 'HOSTING'
    when 'ads'          then 'ADS'
    when 'ai_seo'       then 'AISEO'
    when 'aiseo_web'    then 'AISEOWEB'
    when 'aiseo_local'  then 'AISEOLOC'
    else upper(regexp_replace(coalesce(st, 'JOB'), '[^a-zA-Z0-9]', '', 'g'))
  end;
$$;

-- ROLLBACK: re-apply the bodies from 20260618130000_job_unique_codes.sql
--   (set_job_code without the parent branch; job_service_abbr without aiseo_web/aiseo_local).
```

- [ ] **Step 4: Apply + verify**

Apply via MCP `apply_migration` (name `ai_seo_child_job_codes`), then `supabase test db`.
Expected: PASS (2/2). Also re-run Task 1's test — still green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260624020000_ai_seo_child_job_codes.sql supabase/tests/ai_seo_child_job_codes.sql
git commit -m "feat(jobs): AI SEO child job codes (AISEOWEB/AISEOLOC)"
```

---

## Task 3: Narrow `jobs_web_seo_owner` to web_seo only

AI SEO billing records become unowned; the **web child** (service_type `web_seo`) carries pefstathiadis via the same trigger.

**Files:**
- Create: `supabase/migrations/20260624030000_web_seo_owner_drop_ai_seo.sql`
- Test: `supabase/tests/web_seo_owner_web_only.sql`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/web_seo_owner_web_only.sql
begin;
select plan(2);
do $$
declare v_deal uuid; v_client uuid; v_ai uuid; v_web uuid;
begin
  select id, client_id into v_deal, v_client from public.deals limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, billing_only, billing_active)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active', true, true) returning id into v_ai;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, billing_active)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active', false) returning id into v_web;
  perform set_config('t.ai', v_ai::text, true);
  perform set_config('t.web', v_web::text, true);
end $$;
select is((select owner_user_id from public.jobs where id = current_setting('t.ai')::uuid),
  null, 'ai_seo job is left unowned by the trigger');
select is((select owner_user_id from public.jobs where id = current_setting('t.web')::uuid),
  '19aa9170-bd62-4319-8118-668c11e93c98'::uuid, 'web_seo job still forced to pefstathiadis');
select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — the `ai_seo` job currently gets pefstathiadis (assertion 1 fails).

- [ ] **Step 3: Write the migration**

```sql
-- 20260624030000_web_seo_owner_drop_ai_seo.sql
-- 3-row model: ai_seo is now a billing record (unowned); the web work moves to a
-- web_seo child. Drop the ai_seo branch added in 20260624000000.
create or replace function public.jobs_web_seo_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_type = 'web_seo' then
    new.owner_user_id := '19aa9170-bd62-4319-8118-668c11e93c98';
  end if;
  return new;
end $$;

-- ROLLBACK: restore the web_seo+ai_seo body from 20260624000000.
```

- [ ] **Step 4: Apply + verify**

Apply via MCP `apply_migration` (name `web_seo_owner_drop_ai_seo`), then `supabase test db`.
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260624030000_web_seo_owner_drop_ai_seo.sql supabase/tests/web_seo_owner_web_only.sql
git commit -m "feat(jobs): drop ai_seo branch from web_seo owner trigger (3-row model)"
```

---

## Task 4: `create_custom_job` — emit the AI SEO trio

**Files:**
- Create: `supabase/migrations/20260624040000_create_custom_job_ai_seo_trio.sql`
- Test: `supabase/tests/create_custom_job_ai_seo_trio.sql`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/create_custom_job_ai_seo_trio.sql
begin;
select plan(6);
-- become an admin so the RPC permission gate passes
do $$
declare v_admin uuid; v_deal uuid; r jsonb; v_parent uuid;
begin
  select user_id into v_admin from public.profiles p
    where exists (select 1 from public.user_permissions up
                  where up.user_id = p.user_id and up.capability = 'admin') limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);
  select id into v_deal from public.deals where code is not null limit 1;
  select public.create_custom_job(v_deal, 'AI SEO', null, 'ai_seo', 'recurring_monthly', 300, 24, 0, false, 'none')
    into r;
  perform set_config('t.parent', (r->>'job_id'), true);
end $$;
select is((select service_type from public.jobs where id = current_setting('t.parent')::uuid),
  'ai_seo', 'parent is ai_seo');
select is((select billing_only from public.jobs where id = current_setting('t.parent')::uuid),
  true, 'parent is billing_only');
select is((select amount_net from public.jobs where id = current_setting('t.parent')::uuid),
  300::numeric, 'parent holds the price');
select is(
  (select count(*)::int from public.jobs where parent_job_id = current_setting('t.parent')::uuid),
  2, 'two children created');
select is(
  (select owner_user_id from public.jobs where parent_job_id = current_setting('t.parent')::uuid and service_type='web_seo'),
  '19aa9170-bd62-4319-8118-668c11e93c98'::uuid, 'web child owned by pefstathiadis');
select is(
  (select owner_user_id from public.jobs where parent_job_id = current_setting('t.parent')::uuid and service_type='local_seo'),
  'b73d8761-cbae-4ac8-a239-878d1f2151d8'::uuid, 'local child owned by dtzouvaras');
select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — only one job (the old single ai_seo job); no children.

- [ ] **Step 3: Write the migration**

```sql
-- 20260624040000_create_custom_job_ai_seo_trio.sql
-- AI SEO via accounting now creates 3 rows: ① ai_seo billing record (off-board,
-- holds price) + ② web_seo child + ③ local_seo child (both €0, billing_active=false).
create or replace function public.create_custom_job(
  p_deal_id uuid, p_title text, p_description text, p_department text,
  p_billing_type text, p_amount_net numeric, p_vat_rate numeric,
  p_setup_fee numeric default 0, p_billing_only boolean default false,
  p_installment_plan text default 'none')
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.deals; v_job_id uuid; v_stage uuid; v_owner uuid; v_service text; v_group uuid;
        v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  select * into d from public.deals where id = p_deal_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['deal_not_found']); end if;
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('ok', false, 'errors', array['title_required']); end if;
  if p_billing_type not in ('one_time','recurring_monthly','recurring_yearly') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_billing_type']); end if;
  if coalesce(p_installment_plan, 'none') not in ('none','50_50','50_25_25') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_installment_plan']); end if;
  if coalesce(p_installment_plan, 'none') <> 'none'
     and not (p_department = 'web_dev' and not p_billing_only and p_billing_type = 'one_time') then
    return jsonb_build_object('ok', false, 'errors', array['installment_plan_web_dev_one_time_only']); end if;

  -- AI SEO: billing record + two work cards
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

  -- Generic path (unchanged)
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
      owner_user_id, started_at, code, installment_plan)
    values (d.id, d.client_id, v_service, p_billing_type, coalesce(p_amount_net, 0), coalesce(p_vat_rate, 24),
      coalesce(p_setup_fee, 0), trim(p_title), p_description, true, p_billing_only, true, 'active', v_stage,
      v_group, v_owner, now(), d.code, coalesce(p_installment_plan, 'none'))
    returning id into v_job_id;

  perform public.generate_payments_for_deal(d.id);
  return jsonb_build_object('ok', true, 'job_id', v_job_id);
end $$;
grant execute on function public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean,text) to authenticated;

-- ROLLBACK: re-apply the body from 20260619180000_web_dev_installment_plans.sql.
```

- [ ] **Step 4: Apply + verify**

Apply via MCP `apply_migration` (name `create_custom_job_ai_seo_trio`), then `supabase test db`.
Expected: PASS (6/6). Spot-check via MCP `execute_sql` (in a `begin; … rollback;`) that `generate_payments_for_deal` produced payment lines for the parent only — query `deal_payments` total = 300 and no `deal_payment_lines.job_id` points to a child.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260624040000_create_custom_job_ai_seo_trio.sql supabase/tests/create_custom_job_ai_seo_trio.sql
git commit -m "feat(jobs): create_custom_job emits AI SEO billing record + web/local work cards"
```

---

## Task 5: `release_jobs_for_deal` — emit the AI SEO trio

**Files:**
- Create: `supabase/migrations/20260624050000_release_jobs_ai_seo_trio.sql`
- Test: `supabase/tests/release_jobs_ai_seo_trio.sql`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/release_jobs_ai_seo_trio.sql
begin;
select plan(3);
do $$
declare v_deal uuid; v_client uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  update public.deals set services_planned =
    jsonb_build_array(jsonb_build_object('service_type','ai_seo','billing_type','recurring_monthly','monthly_amount','250'))
    where id = v_deal;
  -- clear any pre-existing jobs for a clean count
  delete from public.jobs where deal_id = v_deal and service_type in ('ai_seo','web_seo','local_seo');
  perform public.release_jobs_for_deal(v_deal, false);
  perform set_config('t.deal', v_deal::text, true);
end $$;
select is((select count(*)::int from public.jobs
  where deal_id = current_setting('t.deal')::uuid and service_type='ai_seo' and billing_only),
  1, 'one ai_seo billing record');
select is((select amount_net from public.jobs
  where deal_id = current_setting('t.deal')::uuid and service_type='ai_seo' and billing_only),
  250::numeric, 'billing record holds the planned amount');
select is((select count(*)::int from public.jobs j
  where j.parent_job_id in (select id from public.jobs where deal_id = current_setting('t.deal')::uuid
    and service_type='ai_seo' and billing_only)),
  2, 'two children linked to it');
select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — one `ai_seo` job on a web stage, no children, not billing_only.

- [ ] **Step 3: Write the migration**

Re-create `release_jobs_for_deal` with an AI SEO special-case at the top of the loop. Base it on the current body in `20260617000013_jobs_at_won_cutover.sql`; insert this block immediately after `billing_type_val` is read and validated, before the generic `one_time_amt := …` logic:

```sql
-- 20260624050000_release_jobs_ai_seo_trio.sql
create or replace function public.release_jobs_for_deal(target_deal_id uuid, partial_payment_mode boolean)
returns int language plpgsql security definer set search_path = public as $$
declare
  d record; service jsonb; service_type_val text; stage_board text; billing_type_val text;
  one_time_amt numeric; monthly_amt numeric; setup_fee_val numeric; group_id_val uuid; owner_id_val uuid;
  job_stage_id uuid; inserted int := 0; should_block boolean;
  existing_job_id uuid; existing_stage uuid;
  v_parent uuid; v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid; v_amt numeric;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads') then continue; end if;
    if billing_type_val not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;

    one_time_amt  := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt   := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block  := partial_payment_mode and service_type_val <> 'web_dev';

    -- AI SEO: billing record + two work cards
    if service_type_val = 'ai_seo' then
      select id into existing_job_id from public.jobs
        where deal_id = d.id and service_type = 'ai_seo' and not archived order by created_at limit 1;
      if existing_job_id is not null then continue; end if;
      v_amt := coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0);
      insert into public.jobs (deal_id, client_id, service_type, billing_type, one_time_amount, monthly_amount,
          setup_fee, amount_net, title, is_custom, billing_only, billing_active, status, stage_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', billing_type_val, one_time_amt, monthly_amt, setup_fee_val, v_amt,
          'AI SEO', false, true, true, 'active', null, now(), d.code)
        returning id into v_parent;

      select id into v_web_stage from public.pipeline_stages where board='web_seo' and archived=false order by position limit 1;
      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'web_seo', billing_type_val, 0, 'AI SEO — Web', true, false, false, 'active',
          v_web_stage, v_web_group, v_parent, now(), d.code,
          should_block, case when should_block then 'partial_payment_pending' else null end,
          case when should_block then now() else null end);

      select id into v_local_stage from public.pipeline_stages where board='local_seo' and archived=false order by position limit 1;
      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'local_seo', billing_type_val, 0, 'AI SEO — Local', true, false, false, 'active',
          v_local_stage, v_local_group, v_parent, now(), d.code,
          should_block, case when should_block then 'partial_payment_pending' else null end,
          case when should_block then now() else null end);

      inserted := inserted + 1;
      continue;
    end if;

    select id into group_id_val from public.groups where code = service_type_val;
    owner_id_val := public.team_lead_for_group(service_type_val);
    stage_board := service_type_val;
    select id into job_stage_id from public.pipeline_stages
      where board = stage_board and archived = false order by position limit 1;

    select id, stage_id into existing_job_id, existing_stage
      from public.jobs where deal_id = d.id and service_type = service_type_val and not archived
      order by created_at limit 1;

    if existing_job_id is not null then
      if existing_stage is null then
        update public.jobs set
          stage_id = job_stage_id,
          owner_user_id = coalesce(owner_user_id, owner_id_val),
          assigned_group_id = coalesce(assigned_group_id, group_id_val),
          is_blocked = should_block,
          blocked_reason = case when should_block then 'partial_payment_pending' else blocked_reason end,
          blocked_at = case when should_block then now() else blocked_at end
        where id = existing_job_id;
        inserted := inserted + 1;
      end if;
      continue;
    end if;

    insert into public.jobs (deal_id, client_id, service_type, billing_type,
        one_time_amount, monthly_amount, setup_fee, amount_net, title,
        stage_id, assigned_group_id, owner_user_id, status, started_at, code,
        is_blocked, blocked_reason, blocked_at)
      values (d.id, d.client_id, service_type_val, billing_type_val,
        one_time_amt, monthly_amt, setup_fee_val,
        coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0),
        initcap(replace(service_type_val, '_', ' ')),
        job_stage_id, group_id_val, owner_id_val, 'active', now(), d.code,
        should_block, case when should_block then 'partial_payment_pending' else null end,
        case when should_block then now() else null end);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $$;
grant execute on function public.release_jobs_for_deal(uuid, boolean) to authenticated;

-- ROLLBACK: re-apply the body from 20260617000013_jobs_at_won_cutover.sql.
```

> Note: the generic `ai_seo → web_seo` `stage_board` case-map is removed because `ai_seo` is now handled by the special-case above and never reaches the generic insert.

- [ ] **Step 4: Apply + verify**

Apply via MCP `apply_migration` (name `release_jobs_ai_seo_trio`), then `supabase test db`.
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260624050000_release_jobs_ai_seo_trio.sql supabase/tests/release_jobs_ai_seo_trio.sql
git commit -m "feat(jobs): release_jobs_for_deal emits AI SEO trio (billing + web/local cards)"
```

---

## Task 6: `end_job` cascades to children (+ verify delete cascade)

**Files:**
- Create: `supabase/migrations/20260624060000_end_job_cascade_children.sql`
- Test: `supabase/tests/end_job_cascade_children.sql`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/end_job_cascade_children.sql
begin;
select plan(2);
do $$
declare v_admin uuid; v_deal uuid; v_client uuid; v_parent uuid; v_child uuid;
begin
  select user_id into v_admin from public.profiles p
    where exists (select 1 from public.user_permissions up
                  where up.user_id = p.user_id and up.capability = 'admin') limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);
  select id, client_id into v_deal, v_client from public.deals limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, billing_only, billing_active)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active', true, true) returning id into v_parent;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, billing_active, parent_job_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active', true, v_parent) returning id into v_child;
  perform public.end_job(v_parent);
  perform set_config('t.child', v_child::text, true);
end $$;
select is((select status from public.jobs where id = current_setting('t.child')::uuid),
  'completed', 'ending the parent completes the child');
select is((select billing_active from public.jobs where id = current_setting('t.child')::uuid),
  false, 'ending the parent deactivates the child');
select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: FAIL — child stays `active`.

- [ ] **Step 3: Write the migration**

```sql
-- 20260624060000_end_job_cascade_children.sql
-- Ending a job also ends its AI SEO work-card children.
create or replace function public.end_job(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_board text;
  v_closed uuid;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  select coalesce(ps.board, j.service_type) into v_board
    from public.jobs j left join public.pipeline_stages ps on ps.id = j.stage_id
   where j.id = p_job_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['job_not_found']); end if;

  select id into v_closed
    from public.pipeline_stages
   where board = v_board and code = 'closed' and archived = false
   limit 1;

  update public.jobs set
    billing_active = false,
    status = case when status in ('cancelled','completed') then status else 'completed' end,
    completed_at = coalesce(completed_at, now()),
    stage_id = coalesce(v_closed, stage_id),
    updated_at = now()
   where id = p_job_id;

  -- cascade to AI SEO work-card children (each on its own board's close lane)
  update public.jobs c set
    billing_active = false,
    status = case when c.status in ('cancelled','completed') then c.status else 'completed' end,
    completed_at = coalesce(c.completed_at, now()),
    stage_id = coalesce(
      (select id from public.pipeline_stages ps
        where ps.board = c.service_type and ps.code = 'closed' and ps.archived = false limit 1),
      c.stage_id),
    updated_at = now()
   where c.parent_job_id = p_job_id;

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end;
$$;

-- ROLLBACK: re-apply the end_job body from 20260622230000_end_job_close_by_stage_board.sql.
```

- [ ] **Step 4: Apply + verify**

Apply via MCP `apply_migration` (name `end_job_cascade_children`), then `supabase test db`.
Expected: PASS (2/2). (Delete-cascade already verified by Task 1; `delete_jobs` needs no change — the FK handles it.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260624060000_end_job_cascade_children.sql supabase/tests/end_job_cascade_children.sql
git commit -m "feat(jobs): end_job cascades to AI SEO work-card children"
```

---

## Task 7: Backfill the 52 existing AI SEO jobs

**Files:**
- Create: `supabase/migrations/20260624070000_backfill_ai_seo_three_row.sql`

- [ ] **Step 1: Write the migration (with backup + idempotency guard)**

```sql
-- 20260624070000_backfill_ai_seo_three_row.sql
-- Convert every existing on-board ai_seo job into the 3-row shape:
--   the job becomes the billing record (billing_only, off-board, unowned);
--   a web_seo child inherits its current stage; a local_seo child starts at the
--   mapped Local stage. Skips jobs already converted (those with children).

-- 1. Snapshot for rollback.
create table if not exists public.jobs_ai_seo_split_backup_20260624 as
select id, stage_id, owner_user_id, billing_only
from public.jobs
where service_type = 'ai_seo' and not archived and stage_id is not null;

-- 2. Create web + local children, then convert the parent. Loop for stage mapping.
do $$
declare j record; v_local_stage uuid; v_local_code text; v_web_group uuid; v_local_group uuid;
begin
  select id into v_web_group from public.groups where code='web_seo';
  select id into v_local_group from public.groups where code='local_seo';
  for j in
    select jb.* from public.jobs jb
    where jb.service_type = 'ai_seo' and not jb.archived and jb.stage_id is not null
      and not exists (select 1 from public.jobs c where c.parent_job_id = jb.id)
  loop
    -- map the parent's web stage code to a local stage code (mirror of kanbanGrouping)
    select case ws.code
      when 'new_project' then 'new_project'
      when 'no_response' then 'called_no_response'
      when 'renewal' then 'renewal'
      when 'stuck' then 'suspended'
      when 'done' then 'done'
      else 'optimize' end
    into v_local_code
    from public.pipeline_stages ws where ws.id = j.stage_id;

    select id into v_local_stage from public.pipeline_stages
      where board='local_seo' and code = coalesce(v_local_code, 'optimize') and archived=false limit 1;
    if v_local_stage is null then
      select id into v_local_stage from public.pipeline_stages
        where board='local_seo' and archived=false order by position limit 1;
    end if;

    -- ② web child (inherits the parent's current web stage; pefstathiadis via trigger)
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, is_blocked, blocked_reason, blocked_at, started_at, code)
      values (j.deal_id, j.client_id, 'web_seo', j.billing_type, 0, coalesce(j.vat_rate,24),
        'AI SEO — Web', true, false, false, j.status, j.stage_id, v_web_group,
        j.id, j.is_blocked, j.blocked_reason, j.blocked_at, j.started_at, j.code);

    -- ③ local child (mapped local stage; dtzouvaras via trigger)
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, is_blocked, blocked_reason, blocked_at, started_at, code)
      values (j.deal_id, j.client_id, 'local_seo', j.billing_type, 0, coalesce(j.vat_rate,24),
        'AI SEO — Local', true, false, false, j.status, v_local_stage, v_local_group,
        j.id, j.is_blocked, j.blocked_reason, j.blocked_at, j.started_at, j.code);

    -- ① convert the original into the billing record (off-board, unowned)
    update public.jobs set billing_only = true, stage_id = null, owner_user_id = null, updated_at = now()
      where id = j.id;
  end loop;
end $$;

-- ROLLBACK:
--   delete from public.jobs where parent_job_id in (select id from public.jobs_ai_seo_split_backup_20260624);
--   update public.jobs j set stage_id = b.stage_id, owner_user_id = b.owner_user_id, billing_only = b.billing_only
--     from public.jobs_ai_seo_split_backup_20260624 b where j.id = b.id;
--   drop table if exists public.jobs_ai_seo_split_backup_20260624;
```

- [ ] **Step 2: Apply via MCP `apply_migration`** (name `backfill_ai_seo_three_row`).

- [ ] **Step 3: Verify via MCP `execute_sql`**

```sql
-- expect: 0 on-board ai_seo jobs; ~52 billing records; ~52 web + ~52 local children
select
  (select count(*) from public.jobs where service_type='ai_seo' and not archived and stage_id is not null) as ai_on_board,
  (select count(*) from public.jobs where service_type='ai_seo' and not archived and billing_only) as ai_billing,
  (select count(*) from public.jobs c where c.parent_job_id is not null and c.service_type='web_seo') as web_children,
  (select count(*) from public.jobs c where c.parent_job_id is not null and c.service_type='local_seo') as local_children;
```
Expected: `ai_on_board=0`, `ai_billing≈52`, `web_children≈52`, `local_children≈52`. Confirm owners: web children = pefstathiadis, local children = dtzouvaras.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260624070000_backfill_ai_seo_three_row.sql
git commit -m "feat(jobs): backfill 52 existing AI SEO jobs into 3-row shape (+ backup table)"
```

---

## Task 8: Hide €0 work children from the deal Overview billing list

**Files:**
- Modify: `src/features/deals/hooks/useJobsBilling.ts` (add `parent_job_id` to the row type + select; filter children out)
- Test: `src/features/deals/hooks/useJobsBilling.test.ts` (create if absent) OR extend `src/features/deals/JobsBillingPanel.test.tsx`

- [ ] **Step 1: Read the hook** to find the `JobBillingRow` type, the `.select('…')` column list, and where the jobs array is returned.

Run: `sed -n '1,120p' src/features/deals/hooks/useJobsBilling.ts`

- [ ] **Step 2: Write the failing test** (filter logic)

```ts
// src/features/deals/hooks/filterBillingJobs.test.ts
import { describe, it, expect } from 'vitest';
import { filterBillingJobs } from './filterBillingJobs';

describe('filterBillingJobs', () => {
  it('keeps top-level jobs and drops AI SEO work-card children', () => {
    const rows = [
      { id: 'p', parent_job_id: null },
      { id: 'w', parent_job_id: 'p' },
      { id: 'l', parent_job_id: 'p' },
      { id: 'x', parent_job_id: null },
    ];
    expect(filterBillingJobs(rows).map((r) => r.id)).toEqual(['p', 'x']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/deals/hooks/filterBillingJobs.test.ts`
Expected: FAIL — module `./filterBillingJobs` not found.

- [ ] **Step 4: Implement**

```ts
// src/features/deals/hooks/filterBillingJobs.ts
/** Work-card children (parent_job_id set) are €0 and shouldn't appear in the
 *  deal Overview billing list — only their parent billing record does. */
export function filterBillingJobs<T extends { parent_job_id: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !r.parent_job_id);
}
```

Then in `useJobsBilling.ts`: add `parent_job_id: string | null` to `JobBillingRow`, add `parent_job_id` to the jobs `.select(...)` column string, and wrap the returned jobs array with `filterBillingJobs(...)`.

- [ ] **Step 5: Run test + build**

Run: `npx vitest run src/features/deals/hooks/filterBillingJobs.test.ts && npm run build`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add src/features/deals/hooks/filterBillingJobs.ts src/features/deals/hooks/filterBillingJobs.test.ts src/features/deals/hooks/useJobsBilling.ts
git commit -m "feat(deals): hide AI SEO work-card children from the Overview billing list"
```

---

## Task 9: Retire the AI-SEO board mirror in `kanbanGrouping.ts`

**Files:**
- Modify: `src/features/jobs/kanbanGrouping.ts`
- Modify: `src/features/jobs/kanbanGrouping.test.ts` (remove the ai_seo-mirror cases)

- [ ] **Step 1: Update the tests first** — delete the two cases that assert `ai_seo` jobs map onto `local_seo` columns (`kanbanGrouping.test.ts:61-64` and the matching block), and any test referencing `aiSeoTargetCode`. Keep the Blocked-column and normal-grouping cases.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/jobs/kanbanGrouping.test.ts`
Expected: FAIL — references to removed exports / changed behavior.

- [ ] **Step 3: Simplify the module**

In `kanbanGrouping.ts`: remove `AI_SEO_TO_LOCAL_SEO`, `LOCAL_SEO_TO_AI_SEO`, and the `aiSeoTargetCode` export. In `groupJobsForBoard`, replace the `code` computation with `const code = jobStage.code;` (drop the `ai_seo && board==='local_seo'` branch). Keep `hasBlockedColumn`/`BLOCKED_COLUMN_BOARDS`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/jobs/kanbanGrouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/kanbanGrouping.ts src/features/jobs/kanbanGrouping.test.ts
git commit -m "refactor(jobs): retire AI-SEO board-mirror grouping (each board has a real card now)"
```

---

## Task 10: Remove the `ai_seo` drag special-case in `JobsKanbanPage.tsx`

**Files:**
- Modify: `src/features/jobs/JobsKanbanPage.tsx` (`onDragEnd`, ~`:88-100`)

- [ ] **Step 1: Edit** — delete the `if (job.service_type === 'ai_seo' && serviceType !== 'web_seo') { … }` block and just use `let targetStageId = stageId;` directly. Remove the now-unused `aiSeoTargetCode` import.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean (no unused-import / type errors).

- [ ] **Step 3: Commit**

```bash
git add src/features/jobs/JobsKanbanPage.tsx
git commit -m "refactor(jobs): drop ai_seo drag remap on the kanban (no cross-board jobs)"
```

---

## Task 11: AI SEO badge on the work cards (`JobsKanbanCard.tsx`)

`ai_seo` jobs are off-board now, so the existing `service_type === 'ai_seo'` badge never renders. Show the badge on the **children** instead so the team sees the AI SEO tag.

**Files:**
- Modify: `src/features/jobs/JobsKanbanCard.tsx` (`:63`)
- Modify: `src/features/jobs/hooks/useJobs.ts` (add `parent_job_id` to `JobRow` + the jobs select)

- [ ] **Step 1: Add `parent_job_id`** to the `JobRow` type and to the jobs `.select(...)` in `useJobs.ts`.

- [ ] **Step 2: Edit the badge** — change `{job.service_type === 'ai_seo' && (` to `{job.parent_job_id != null && (` so the violet "AI SEO" pill shows on the Web/Local work cards.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/JobsKanbanCard.tsx src/features/jobs/hooks/useJobs.ts
git commit -m "feat(jobs): show AI SEO badge on the web/local work cards"
```

---

## Task 12: "Part of AI SEO" banner on the work-child detail page

**Files:**
- Modify: `src/features/jobs/JobDetailPage.tsx` (read `parent_job_id`; if set, fetch the parent's code/title/amount and render a read-only banner linking to `/jobs/<parent>`)
- Modify: i18n — `src/locales/en.json` + `src/locales/el.json` (or the project's i18n files)

- [ ] **Step 1: Locate the detail page + i18n files**

Run: `ls src/features/jobs/JobDetailPage.tsx; ls src/locales 2>/dev/null || grep -rln "i18n" src/lib | head`

- [ ] **Step 2: Add i18n keys** (en + el):
  - `jobs.part_of_ai_seo` — en: `"Part of AI SEO {{code}} · €{{amount}}"`, el: `"Μέρος του AI SEO {{code}} · €{{amount}}"`
  - `jobs.view_billing_record` — en: `"View billing record"`, el: `"Προβολή χρέωσης"`

- [ ] **Step 3: Render the banner** — when `job.parent_job_id` is set, query the parent job (`id, code, title, amount_net`) and show a small read-only banner above the job body with a `<Link to={`/jobs/${parentId}`}>` using the keys above.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/JobDetailPage.tsx src/locales/en.json src/locales/el.json
git commit -m "feat(jobs): work-card detail shows 'Part of AI SEO' link to the billing record"
```

---

## Task 13: Final verification + push

- [ ] **Step 1: Full test + build**

Run: `npm run test:run && npm run build`
Expected: all green; build clean (eslint `--max-warnings=0`).

- [ ] **Step 2: Prod round-trip smoke (MCP, rolled back)** — in a `begin; … rollback;` block via `execute_sql`, call `create_custom_job(<scratch deal>, 'AI SEO', null, 'ai_seo', 'recurring_monthly', 300, 24, 0, false, 'none')` and assert: 1 billing record (€300, billing_only), 2 children (€0, correct owners, codes `…-AISEOWEB`/`…-AISEOLOC`), and `deal_payments` for that deal total €300 with no line pointing at a child.

- [ ] **Step 3: Live UI spot-check** — on a converted real deal: deal Overview shows one "AI SEO €X" line; the Web SEO board shows its "AI SEO — Web" card (owner pefstathiadis); the Local SEO board shows its "AI SEO — Local" card (owner dtzouvaras).

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Update memory** — record the 3-row AI SEO model in `project_local_seo_owner.md` / `MEMORY.md` (supersedes the `ai_seo→pefstathiadis` single-owner note), and rotate the chat-shared sbp token per project convention.

---

## Self-review notes (author)

- **Spec coverage:** A→Task1, B→Task2, C→Task4, D→Task5, E→Task3, F→Tasks 9–11, G→Task8(+12), H→Task7, I→Task6(+Task1 cascade). All covered.
- **No double-billing:** children are `amount_net=0` + `billing_active=false`; `generate_payments_for_deal` filters `where billing_active`. Verified in Task 4/13.
- **Ordering:** Task 3 before Task 4 (billing record stays unowned); Task 7 backfill before the Task 9–11 frontend deploy (no empty boards mid-flight).
- **delete_jobs:** unchanged — FK `on delete cascade` (Task 1) handles children.
