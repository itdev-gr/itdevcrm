-- =============================================================================
-- 2026-08-31: deal 006042 — a web_seo job opened at conversion for a service
-- that was never sold: the lead carried a services_planned row with no amounts
-- (the lead form allows it), convert_lead_to_client only validates the TOTAL
-- value, and the deals AFTER INSERT seeder (deals_seed_payments →
-- seed_deal_jobs_and_payments → release_billing_jobs_for_deal) opens a job for
-- every valid service row, accepting 0 euro.
--
-- Owner decision 2026-08-31: an unpriced planned service BLOCKS the convert
-- with a per-service error; existing 0-euro jobs/leads are report-only.
--
-- 1. convert_lead_to_client: per-service amount validation → error
--    'service_amount_required:<service_type>' (frontend translates).
--    Base body verbatim: 20260831190000_ud_audit_fixes.sql
--    (live pre-md5 cb0ff9abdea46a31a50bf5b9ef50658f, pulled 2026-08-31).
-- 2. release_billing_jobs_for_deal: skip unpriced rows (defense in depth for
--    any other deal-insert path). Base body verbatim:
--    20260728120000_domains_service.sql
--    (live pre-md5 87846c8d0fea3a18c72fa703d5741946).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.convert_lead_to_client(target_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l record; errors text[] := '{}'; service_count int;
  service jsonb; svc_st text; svc_bt text; svc_amount numeric;
  won_stage_id uuid; deal_won_stage_id uuid; acc_new_stage_id uuid; new_client_id uuid; new_deal_id uuid; full_name text;
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
  -- 2026-08-31 (006042): a planned service row with no amount must not convert.
  -- The deals AFTER INSERT seeder (release_billing_jobs_for_deal) opens a job
  -- for every valid service row, so an unpriced row becomes a phantom 0-euro
  -- job on the brand-new client. Same service/billing sets as the seeder.
  for service in select * from jsonb_array_elements(coalesce(l.services_planned, '[]'::jsonb)) loop
    svc_st := service->>'service_type';
    svc_bt := service->>'billing_type';
    if svc_st not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise','domains') then continue; end if;
    if svc_bt not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    svc_amount := coalesce(nullif(service->>'setup_fee','')::numeric, 0)
      + case when svc_bt = 'one_time' then coalesce(nullif(service->>'one_time_amount','')::numeric, 0)
             else coalesce(nullif(service->>'monthly_amount','')::numeric, 0) end;
    if svc_amount <= 0 then
      errors := array_append(errors, 'service_amount_required:' || svc_st);
    end if;
  end loop;
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

  -- Won stage of the board the lead currently sits on (under_development keeps
  -- its card in its own Won column); sales/won when the board has none.
  select ps.id into won_stage_id
    from public.pipeline_stages ps
    join public.pipeline_stages cur on cur.id = l.stage_id
   where ps.board = cur.board and ps.terminal_outcome = 'won' and not ps.archived
   order by ps.position
   limit 1;
  if won_stage_id is null then
    select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  end if;
  -- Deals always carry the SALES board's won stage: deal reports join on it
  -- and accounting_create_deal writes the same; the LEAD still lands on its
  -- own board's won (ud_won for UD leads).
  select id into deal_won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  insert into public.deals (
    client_id, title, description, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by, code, won_by_user_id, payment_method, cash_charge_vat, sales_note,
    business_profile_url, business_profile_name
  ) values (
    new_client_id,
    coalesce(nullif(trim(l.title), ''), full_name || ' deal'),
    l.notes, null,
    l.estimated_one_time_value, l.estimated_monthly_value, l.services_planned,
    l.expected_close_date, current_date,
    coalesce(deal_won_stage_id, won_stage_id, l.stage_id), acc_new_stage_id,
    now(), auth.uid(), l.code, auth.uid(), l.payment_method, l.cash_charge_vat, l.additional_notes,
    l.business_profile_url, l.business_profile_name
  ) returning id into new_deal_id;

  update public.comments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  update public.attachments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  -- Carry captured lead emails onto the new client + deal (keep lead_id as history).
  update public.email_messages set client_id = new_client_id, deal_id = new_deal_id
    where lead_id = l.id;
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
    if st not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise','domains') then continue; end if;
    if bt not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    -- 2026-08-31 (006042): never open a job for an unpriced service row —
    -- defense in depth behind the convert_lead_to_client validation (other
    -- deal-insert paths must not spawn phantom 0-euro jobs either). The AI SEO
    -- 0-euro children below are unaffected: they are explicit inserts, not
    -- services_planned rows.
    if coalesce(nullif(service->>'one_time_amount','')::numeric, 0)
       + coalesce(nullif(service->>'monthly_amount','')::numeric, 0)
       + coalesce(nullif(service->>'setup_fee','')::numeric, 0) <= 0 then continue; end if;
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

-- ROLLBACK:
--   Re-emit convert_lead_to_client from 20260831190000_ud_audit_fixes.sql
--   (pre-md5 cb0ff9abdea46a31a50bf5b9ef50658f) and
--   release_billing_jobs_for_deal from 20260728120000_domains_service.sql
--   (pre-md5 87846c8d0fea3a18c72fa703d5741946). No data changes to revert.
