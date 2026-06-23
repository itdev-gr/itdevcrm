-- =============================================================================
-- accounting_create_deal: accounting creates a deal (existing or new client)
-- directly on the onboarding board, landing in the 'new' stage. Also creates a
-- matching converted 'won' lead (source='import', automations off) so lead-intake
-- dedup catches the same customer later. Deal + lead (+ new client) share one code.
-- =============================================================================
create or replace function public.accounting_create_deal(
  p_client_id uuid default null,
  p_new_client jsonb default null,
  p_title text default null,
  p_one_time numeric default 0,
  p_monthly numeric default 0,
  p_payment_method text default null,
  p_description text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  errors text[] := '{}';
  v_title text;
  v_pm text;
  v_code text;
  v_client_id uuid;
  v_client record;
  won_stage_id uuid;
  acc_new_stage_id uuid;
  v_deal_id uuid;
begin
  -- permission: admin OR accounting_onboarding.create
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding', 'create')) then
    return jsonb_build_object('ok', false, 'errors', array['not_authorized']);
  end if;

  -- validate
  if p_client_id is null and p_new_client is null then
    errors := array_append(errors, 'missing_client');
  end if;
  if p_client_id is not null and p_new_client is not null then
    errors := array_append(errors, 'ambiguous_client');
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    errors := array_append(errors, 'missing_title');
  end if;

  if p_new_client is not null
     and nullif(trim(coalesce(p_new_client->>'name', '')), '') is null then
    errors := array_append(errors, 'missing_client_name');
  end if;

  if coalesce(p_one_time, 0) < 0 or coalesce(p_monthly, 0) < 0 then
    errors := array_append(errors, 'invalid_amount');
  end if;

  v_pm := nullif(trim(coalesce(p_payment_method, '')), '');
  if v_pm is not null and v_pm not in ('cash', 'online') then
    errors := array_append(errors, 'invalid_payment_method');
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  -- one shared code for deal + won lead (+ new client)
  v_code := public.generate_lead_code();

  -- resolve / create client
  if p_new_client is not null then
    insert into public.clients (
      name, contact_first_name, contact_last_name, email, phone, address,
      industry, country, vat_number, website, assigned_owner_id, code, start_date
    ) values (
      trim(p_new_client->>'name'),
      nullif(trim(coalesce(p_new_client->>'contact_first_name', '')), ''),
      nullif(trim(coalesce(p_new_client->>'contact_last_name', '')), ''),
      nullif(trim(coalesce(p_new_client->>'email', '')), ''),
      nullif(trim(coalesce(p_new_client->>'phone', '')), ''),
      nullif(trim(coalesce(p_new_client->>'address', '')), ''),
      nullif(trim(coalesce(p_new_client->>'industry', '')), ''),
      nullif(trim(coalesce(p_new_client->>'country', '')), ''),
      nullif(trim(coalesce(p_new_client->>'vat_number', '')), ''),
      nullif(trim(coalesce(p_new_client->>'website', '')), ''),
      null, v_code, current_date
    ) returning id into v_client_id;
  else
    select id into v_client_id from public.clients where id = p_client_id;
    if v_client_id is null then
      return jsonb_build_object('ok', false, 'errors', array['client_not_found']);
    end if;
    -- one-live-deal-per-client guard (mirrors the deals_one_live_per_client
    -- partial unique index: at most one non-archived deal per client). Surface a
    -- clean error instead of letting the raw 23505 bubble to the UI.
    if exists (
      select 1 from public.deals where client_id = v_client_id and archived = false
    ) then
      return jsonb_build_object('ok', false, 'errors', array['client_has_live_deal']);
    end if;
  end if;

  -- load client row for the lead's contact fields (existing or just-created)
  select * into v_client from public.clients where id = v_client_id;

  -- stages
  select id into won_stage_id
    from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id
    from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  -- deal (owner_user_id / won_by_user_id default null; currency/services_planned use defaults)
  insert into public.deals (
    client_id, title, description,
    one_time_value, recurring_monthly_value, payment_method,
    stage_id, accounting_stage_id,
    locked_at, locked_by, actual_close_date, code
  ) values (
    v_client_id, v_title, nullif(trim(coalesce(p_description, '')), ''),
    coalesce(p_one_time, 0), coalesce(p_monthly, 0), v_pm,
    won_stage_id, acc_new_stage_id,
    now(), auth.uid(), current_date, v_code
  ) returning id into v_deal_id;

  -- matching converted 'won' lead (dedup record). source='import' => no welcome
  -- email; automations_enabled=false => no won emails if ever updated;
  -- owner_user_id non-null => round-robin trigger is a no-op; phone_normalized
  -- auto-stamps from phone.
  insert into public.leads (
    source, title, code, stage_id, automations_enabled,
    converted_at, converted_deal_id, converted_client_id,
    company_name, contact_first_name, contact_last_name, email, phone,
    address, industry, country, vat_number, website,
    estimated_one_time_value, estimated_monthly_value, owner_user_id
  ) values (
    'import', v_title, v_code, won_stage_id, false,
    now(), v_deal_id, v_client_id,
    v_client.name, v_client.contact_first_name, v_client.contact_last_name,
    v_client.email, v_client.phone,
    v_client.address, v_client.industry, v_client.country, v_client.vat_number, v_client.website,
    coalesce(p_one_time, 0), coalesce(p_monthly, 0), auth.uid()
  );

  return jsonb_build_object('ok', true, 'deal_id', v_deal_id, 'code', v_code);
end $$;

grant execute on function public.accounting_create_deal(
  uuid, jsonb, text, numeric, numeric, text, text
) to authenticated;

-- Rollback:
-- drop function if exists public.accounting_create_deal(uuid, jsonb, text, numeric, numeric, text, text);
