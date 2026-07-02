-- 2026-07-02: Explicit "charge VAT?" choice for cash payments (default: no VAT).
-- Forward-only: existing rows/jobs are untouched.
-- Plan: docs/superpowers/plans/2026-07-02-cash-vat-toggle.md
--
-- Adds cash_charge_vat to leads + deals and makes the billing-seed functions
-- (release_billing_jobs_for_deal, release_jobs_for_deal) + the lead->deal
-- conversion (convert_lead_to_client) respect it:
--   vat_rate = (payment_method='cash' AND NOT cash_charge_vat) ? 0 : country rate.
-- Function bodies below are the live prod definitions with ONLY the VAT logic /
-- cash_charge_vat copy changed (drift-checked at authoring time).

alter table public.leads add column if not exists cash_charge_vat boolean not null default false;
alter table public.deals add column if not exists cash_charge_vat boolean not null default false;

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
    if exists (select 1 from public.jobs where deal_id = d.id and service_type = st and not archived) then continue; end if;

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

CREATE OR REPLACE FUNCTION public.convert_lead_to_client(target_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l record; errors text[] := '{}'; service_count int;
  won_stage_id uuid; acc_new_stage_id uuid; new_client_id uuid; new_deal_id uuid; full_name text;
begin
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  select * into l from public.leads where id = target_lead_id;
  if l is null then return jsonb_build_object('ok', false, 'errors', array['lead_not_found']); end if;
  if l.converted_at is not null then return jsonb_build_object('ok', false, 'errors', array['already_converted']); end if;
  if l.archived then return jsonb_build_object('ok', false, 'errors', array['lead_archived']); end if;
  if coalesce(l.estimated_one_time_value, 0) + coalesce(l.estimated_monthly_value, 0) <= 0 then
    errors := array_append(errors, 'value_required'); end if;
  service_count := coalesce(jsonb_array_length(l.services_planned), 0);
  if service_count = 0 then errors := array_append(errors, 'at_least_one_service_required'); end if;
  if l.email is null or l.email = '' then errors := array_append(errors, 'email_required'); end if;
  if (l.phone is null or l.phone = '') and (l.address is null or l.address = '') then
    errors := array_append(errors, 'phone_or_address_required'); end if;
  if l.company_name is null or trim(l.company_name) = '' then errors := array_append(errors, 'company_name_required'); end if;
  if l.payment_method is null or l.payment_method = '' then errors := array_append(errors, 'payment_method_required'); end if;
  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors); end if;

  insert into public.clients (
    name, contact_first_name, contact_last_name, email, phone, address,
    industry, country, vat_number, website, assigned_owner_id, code, start_date,
    contact_info, additional_contacts
  ) values (
    l.company_name, l.contact_first_name, l.contact_last_name, l.email, l.phone, l.address,
    l.industry, l.country, l.vat_number, l.website, null, l.code, current_date,
    l.contact_info, coalesce(l.additional_contacts, '[]'::jsonb)
  ) returning id into new_client_id;

  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  insert into public.deals (
    client_id, title, description, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by, code, won_by_user_id, payment_method, cash_charge_vat, sales_note,
    business_profile_url
  ) values (
    new_client_id,
    coalesce(nullif(trim(l.title), ''), full_name || ' deal'),
    l.notes, null,
    l.estimated_one_time_value, l.estimated_monthly_value, l.services_planned,
    l.expected_close_date, current_date,
    coalesce(won_stage_id, l.stage_id), acc_new_stage_id,
    now(), auth.uid(), l.code, auth.uid(), l.payment_method, l.cash_charge_vat, l.additional_notes,
    l.business_profile_url
  ) returning id into new_deal_id;

  update public.comments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  update public.attachments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  update public.leads set
      converted_at = now(), converted_client_id = new_client_id, converted_deal_id = new_deal_id,
      stage_id = coalesce(won_stage_id, stage_id), won_by_user_id = auth.uid()
    where id = l.id;

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (l.owner_user_id, 'lead_converted',
      jsonb_build_object('lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code));
  end if;

  return jsonb_build_object('ok', true, 'lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code);
end $function$;

-- ROLLBACK:
--   restore release_billing_jobs_for_deal, release_jobs_for_deal, convert_lead_to_client
--     from their pre-migration definitions (country-only v_vat; no cash_charge_vat copy);
--   alter table public.leads drop column if exists cash_charge_vat;
--   alter table public.deals drop column if exists cash_charge_vat;
