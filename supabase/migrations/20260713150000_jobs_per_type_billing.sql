-- 2026-07-13: Multiple same-service jobs per deal — spawn + linking fns.
-- Plan:  docs/superpowers/plans/2026-07-13-multi-same-type-jobs.md
-- Spec:  docs/superpowers/specs/2026-07-13-multi-same-type-jobs-design.md
--
-- Scope: a deal may carry ONE job per (service_type, billing_type) pair (e.g.
-- the same service sold one-time AND recurring). Two chains with the SAME
-- (service_type, billing_type) stay unsupported/skipped, exactly as today —
-- chain identity is (deal_id, service_type, billing_type), so NO identity/guard
-- changes are needed. This migration only widens the four dedupe/line-link
-- lookups that previously keyed on service_type alone to also key on
-- billing_type. Function bodies below are copied VERBATIM from their base
-- definitions (drift-checked at authoring time); ONLY the single billing_type
-- clause per fn is added.
--
-- Per-fn base pointers (drift-check the live def against these before revert):
--   release_billing_jobs_for_deal → 20260702160000_cash_charge_vat.sql (dedupe guard)
--   release_jobs_for_deal         → 20260702160000_cash_charge_vat.sql (reuse-or-insert lookup)
--   seed_deal_jobs_and_payments   → 20260617000013_jobs_at_won_cutover.sql (payment→job line-link)
--   recompute_job_period_dates    → 20260703000000_recompute_period_service_match.sql (service-match arm)
--
-- ROLLBACK (fn bodies): re-apply each named base file verbatim — drift-check the
--   live def first (prod bodies drift), then restore. Each base's own header
--   documents its provenance (cash_charge_vat / cutover / recompute fix).
--
-- ROLLBACK (005906 repair — applied live by the controller, NOT in this file):
--   The controller re-runs release_billing_jobs_for_deal('56e18150-3a7d-4f57-bbc3-0e6145064712')
--   to spawn the missing recurring Local SEO job (code 005906-LOCALSEO-2,
--   recurring_monthly, 233.87, billing_active) and links the existing recurring
--   payment's line to it. To revert that repair:
--     delete from public.deal_payment_lines l
--       using public.jobs j
--      where l.job_id = j.id and j.code = '005906-LOCALSEO-2';
--     update public.jobs set archived = true, updated_at = now()
--      where code = '005906-LOCALSEO-2';

-- 1) release_billing_jobs_for_deal — base 20260702160000_cash_charge_vat.sql.
--    EDIT: dedupe guard adds `billing_type = coalesce(service->>'billing_type','one_time')`
--    so a one-time and a recurring job of the same service_type both spawn.
CREATE OR REPLACE FUNCTION public.release_billing_jobs_for_deal(target_deal_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d record; service jsonb; st text; bt text; v_amount numeric; v_vat numeric;
        v_group uuid; v_country text; inserted int := 0;
        v_parent uuid; v_web_group uuid; v_local_group uuid;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    when trim(coalesce(v_country, '')) ilike 'cyprus' then 0.00
    else 24.00 end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    st := service->>'service_type';
    bt := service->>'billing_type';
    if st not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads') then continue; end if;
    if bt not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    if exists (select 1 from public.jobs where deal_id = d.id and service_type = st and billing_type = coalesce(service->>'billing_type','one_time') and not archived) then continue; end if;

    v_amount := coalesce(case when bt = 'one_time' then nullif(service->>'one_time_amount','')::numeric
                              else nullif(service->>'monthly_amount','')::numeric end, 0);

    -- AI SEO: off-board billing record + off-board web & local work cards (placed at Fully Paid).
    if st = 'ai_seo' then
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
          one_time_amount, monthly_amount, setup_fee, title, is_custom, billing_only, billing_active,
          status, stage_id, owner_user_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', bt, v_amount, v_vat,
          nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
          nullif(service->>'setup_fee','')::numeric, 'AI SEO', false, true, true,
          'active', null, null, now(), d.code)
        returning id into v_parent;

      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'web_seo', bt, 0, v_vat, 'AI SEO — Web',
          true, false, false, 'active', null, v_web_group, v_parent, now(), d.code);  -- OFF-BOARD until Fully Paid

      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code)
        values (d.id, d.client_id, 'local_seo', bt, 0, v_vat, 'AI SEO — Local',
          true, false, false, 'active', null, v_local_group, v_parent, now(), d.code);  -- OFF-BOARD until Fully Paid

      inserted := inserted + 1;
      continue;
    end if;

    select id into v_group from public.groups where code = st;
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        one_time_amount, monthly_amount, setup_fee, title, stage_id, assigned_group_id, owner_user_id,
        status, billing_active, is_custom, started_at, code)
      values (d.id, d.client_id, st, bt, v_amount, v_vat,
        nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
        nullif(service->>'setup_fee','')::numeric, initcap(replace(st, '_', ' ')),
        null, v_group, null,                       -- OFF-BOARD: stage_id null, no owner yet
        'active', true, false, now(), d.code);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $function$;

-- 2) release_jobs_for_deal — base 20260702160000_cash_charge_vat.sql.
--    EDIT: reuse-or-insert existing-job lookup adds `and billing_type = billing_type_val`.
--    The ai_seo branch keeps its own type-only dedupe (unchanged).
CREATE OR REPLACE FUNCTION public.release_jobs_for_deal(target_deal_id uuid, partial_payment_mode boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record; service jsonb; service_type_val text; stage_board text; billing_type_val text;
  one_time_amt numeric; monthly_amt numeric; setup_fee_val numeric; group_id_val uuid; owner_id_val uuid;
  job_stage_id uuid; inserted int := 0; should_block boolean;
  existing_job_id uuid; existing_stage uuid;
  v_parent uuid; v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid; v_amt numeric;
  v_vat numeric; v_country text;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    when trim(coalesce(v_country, '')) ilike 'cyprus' then 0.00
    else 24.00 end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads') then continue; end if;
    if billing_type_val not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    -- Partial Payment releases ONLY web_dev + hosting; the rest wait for Fully Paid.
    if partial_payment_mode and service_type_val not in ('web_dev','hosting') then continue; end if;

    one_time_amt  := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt   := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block  := partial_payment_mode and service_type_val not in ('web_dev','hosting');  -- => false (web_dev/hosting released unblocked)

    -- AI SEO: billing record + two work cards
    if service_type_val = 'ai_seo' then
      select id into existing_job_id from public.jobs
        where deal_id = d.id and service_type = 'ai_seo' and not archived order by created_at limit 1;
      if existing_job_id is not null then continue; end if;
      v_amt := coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0);
      insert into public.jobs (deal_id, client_id, service_type, billing_type, one_time_amount, monthly_amount,
          setup_fee, amount_net, vat_rate, title, is_custom, billing_only, billing_active, status, stage_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', billing_type_val, one_time_amt, monthly_amt, setup_fee_val, v_amt, v_vat,
          'AI SEO', false, true, true, 'active', null, now(), d.code)
        returning id into v_parent;

      select id into v_web_stage from public.pipeline_stages where board='web_seo' and archived=false order by position limit 1;
      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'web_seo', billing_type_val, 0, v_vat, 'AI SEO — Web', true, false, false, 'active',
          v_web_stage, v_web_group, v_parent, now(), d.code,
          should_block, case when should_block then 'partial_payment_pending' else null end,
          case when should_block then now() else null end);

      select id into v_local_stage from public.pipeline_stages where board='local_seo' and archived=false order by position limit 1;
      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title, is_custom,
          billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'local_seo', billing_type_val, 0, v_vat, 'AI SEO — Local', true, false, false, 'active',
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
      from public.jobs where deal_id = d.id and service_type = service_type_val and billing_type = billing_type_val and not archived
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
        one_time_amount, monthly_amount, setup_fee, amount_net, vat_rate, title,
        stage_id, assigned_group_id, owner_user_id, status, started_at, code,
        is_blocked, blocked_reason, blocked_at)
      values (d.id, d.client_id, service_type_val, billing_type_val,
        one_time_amt, monthly_amt, setup_fee_val,
        coalesce(case when billing_type_val = 'one_time' then one_time_amt else monthly_amt end, 0), v_vat,
        initcap(replace(service_type_val, '_', ' ')),
        job_stage_id, group_id_val, owner_id_val, 'active', now(), d.code,
        should_block, case when should_block then 'partial_payment_pending' else null end,
        case when should_block then now() else null end);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $function$;

-- 3) seed_deal_jobs_and_payments — base 20260617000013_jobs_at_won_cutover.sql.
--    EDIT: payment→job line-link lookup adds `and j.billing_type = p.billing_type`
--    so a recurring payment binds to the recurring job, not the one-time sibling.
create or replace function public.seed_deal_jobs_and_payments(target_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.release_billing_jobs_for_deal(target_deal_id);
  perform public.seed_deal_payments(target_deal_id);   -- unchanged: installments, setup, net-basis
  insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
  select p.id,
         (select j.id from public.jobs j
           where j.deal_id = p.deal_id and j.service_type = p.service_type and j.billing_type = p.billing_type and not j.archived
           order by j.created_at limit 1),
         coalesce(p.label, p.service_type), p.amount_net, p.vat_rate
  from public.deal_payments p
  where p.deal_id = target_deal_id
    and not exists (select 1 from public.deal_payment_lines l where l.payment_id = p.id);
end $$;
grant execute on function public.seed_deal_jobs_and_payments(uuid) to authenticated;

-- 4) recompute_job_period_dates — base 20260703000000_recompute_period_service_match.sql.
--    EDIT: the service-type match arm gains `and dp.billing_type = j.billing_type`
--    so the one-time job takes the one-time payment's dates and the recurring job
--    takes its own. The line-link arm is unchanged.
CREATE OR REPLACE FUNCTION public.recompute_job_period_dates(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_parent uuid;
  v_start  date;
  v_due    date;
begin
  select parent_job_id into v_parent from public.jobs where id = p_job_id;
  if v_parent is not null then
    select period_start_date, period_due_date into v_start, v_due
      from public.jobs where id = v_parent;
    update public.jobs
       set period_start_date = v_start,
           period_due_date   = v_due,
           updated_at        = now()
     where id = p_job_id
       and (period_start_date is distinct from v_start
         or period_due_date   is distinct from v_due);
    return;
  end if;

  -- Newest PAID payment for this job: either explicitly line-linked to the job,
  -- OR matching the job's deal + service_type. A single query (not primary-then-
  -- fallback) so a newer service-matched paid period wins even when an OLDER
  -- payment carries the deal_payment_line. Recurring renewals link the new
  -- period's line to the first job of the service by created_at, which may be a
  -- sibling job — under the old two-step logic that froze this job's due date one
  -- period back even though the client had paid the newer period.
  select dp.start_date, dp.end_date into v_start, v_due
    from public.deal_payments dp
    join public.jobs j on j.id = p_job_id
   where dp.deal_id = j.deal_id
     and dp.status = 'paid'
     and (
          (dp.service_type = j.service_type and dp.billing_type = j.billing_type)
       or exists (select 1 from public.deal_payment_lines dpl
                   where dpl.payment_id = dp.id and dpl.job_id = p_job_id)
     )
   order by dp.end_date desc, dp.start_date desc
   limit 1;

  -- Collapse start=end (one_time convention) to NULL due — the payment period
  -- IS a single day, so no meaningful "Due" exists.
  if v_due is not null and v_due = v_start then
    v_due := null;
  end if;

  update public.jobs
     set period_start_date = v_start,
         period_due_date   = v_due,
         updated_at        = now()
   where id = p_job_id
     and (period_start_date is distinct from v_start
       or period_due_date   is distinct from v_due);
end $function$;
