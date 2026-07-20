-- ============================================================================
-- Centralize country→VAT rule in public.vat_rate_for_country (adds UAE at 0%)
-- ----------------------------------------------------------------------------
-- Reason: several functions hand-copied the rule
--   "case when country ilike 'cyprus' then 0 else 24 end".
-- United Arab Emirates was added as a 0%-VAT country (frontend
-- src/lib/countries.ts and accounting_integrity_alerts already know it), so
-- lead-converted UAE deals were being seeded at 24% wrongly. This migration
-- adds a single helper and repoints every carrier of the inline rule at it.
--
-- Functions touched (recreated from their LIVE prod bodies with ONLY the
-- inline cyprus CASE expression swapped for the helper call; cash-no-VAT
-- branches preserved verbatim):
--   * public.seed_deal_payments(uuid)
--   * public.release_billing_jobs_for_deal(uuid)
--   * public.release_jobs_for_deal(uuid, boolean)
-- Left untouched on purpose: public.accounting_integrity_alerts()
-- (already UAE-aware).
--
-- ROLLBACK: pre-change live bodies are saved (untracked scratch) at
--   .superpowers/sdd/pre-vat-helper-seed_deal_payments.sql
--   .superpowers/sdd/pre-vat-helper-release_billing_jobs_for_deal.sql
--   .superpowers/sdd/pre-vat-helper-release_jobs_for_deal.sql
-- Restore by executing those three files as-is (each is a full
-- CREATE OR REPLACE FUNCTION), then optionally:
--   drop function public.vat_rate_for_country(text);
-- ============================================================================

-- 1) The single source of truth for country→VAT.
create or replace function public.vat_rate_for_country(p_country text)
returns numeric language sql immutable
as $$ select case when trim(coalesce(p_country,'')) ilike 'cyprus'
                    or trim(coalesce(p_country,'')) ilike 'united arab emirates'
             then 0.00 else 24.00 end $$;
revoke all on function public.vat_rate_for_country(text) from public, anon;
grant execute on function public.vat_rate_for_country(text) to authenticated;

-- 2) seed_deal_payments — inline rule -> helper.
CREATE OR REPLACE FUNCTION public.seed_deal_payments(target_deal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record; svc jsonb; idx int := 0; s_start date; s_end date;
  net numeric(12,4); setup_net numeric(12,4); vat numeric(5,2);
  client_country text; bt text; st text; term text; pct numeric[]; i int;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return; end if;
  if exists (select 1 from public.deal_payments where deal_id = d.id) then return; end if;
  if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then return; end if;

  select c.country into client_country from public.clients c where c.id = d.client_id;
  vat := public.vat_rate_for_country(client_country);
  s_start := coalesce(d.actual_close_date, current_date);

  for svc in select * from jsonb_array_elements(d.services_planned)
  loop
    bt := coalesce(svc->>'billing_type', 'one_time');
    st := svc->>'service_type';
    term := svc->>'payment_terms';
    setup_net := coalesce(nullif(svc->>'setup_fee','')::numeric, 0);

    if bt = 'one_time' and st = 'web_dev' and term in ('50_50', '50_25_25') then
      -- Website paid in installments: split the one-time total.
      net := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0);
      pct := case when term = '50_25_25' then array[0.5, 0.25, 0.25]::numeric[]
                  else array[0.5, 0.5]::numeric[] end;
      for i in 1 .. array_length(pct, 1) loop
        insert into public.deal_payments
          (deal_id, service_type, service_index, billing_type, amount_net, vat_rate,
           start_date, end_date, label)
          values (d.id, st, idx, 'one_time', round(net * pct[i], 4), vat, s_start, s_start,
                  'Installment ' || i || '/' || array_length(pct, 1));
        idx := idx + 1;
      end loop;
    else
      -- one_time (incl. 'full'/no term), recurring_monthly, recurring_yearly.
      if bt = 'one_time' then
        net := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0); s_end := s_start;
      elsif bt = 'recurring_monthly' then
        net := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0); s_end := s_start + interval '1 month';
      elsif bt = 'recurring_yearly' then
        net := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0); s_end := s_start + interval '1 year';
      else
        net := 0; s_end := s_start;
      end if;
      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
        values (d.id, st, idx, bt, round(net, 4), vat, s_start, s_end);
      idx := idx + 1;
    end if;

    if setup_net > 0 then
      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate,
         start_date, end_date, label)
        values (d.id, st, idx, 'one_time', round(setup_net, 4), vat, s_start, s_start, 'Setup fee');
      idx := idx + 1;
    end if;
  end loop;
end $function$;

-- 3) release_billing_jobs_for_deal — cyprus branch -> helper (cash branch kept).
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
    else public.vat_rate_for_country(v_country) end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    st := service->>'service_type';
    bt := service->>'billing_type';
    if st not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance') then continue; end if;
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

-- 4) release_jobs_for_deal — cyprus branch -> helper (cash branch kept).
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
    else public.vat_rate_for_country(v_country) end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance') then continue; end if;
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
