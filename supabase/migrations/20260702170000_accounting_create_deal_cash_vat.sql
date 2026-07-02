-- 2026-07-02: accounting_create_deal accepts p_cash_charge_vat (default false)
-- and stores it on the created deal (+ its dedup lead) so the accounting
-- "New deal" dialog's cash "Charge VAT" checkbox reaches billing.
-- Only meaningful for cash: v_ccv = (v_pm='cash') and coalesce(p_cash_charge_vat,false).
-- Signature change (extra param) => drop old + create new; all params keep
-- defaults so existing named-param calls without p_cash_charge_vat still work.
-- Body is the live prod def with only the cash_charge_vat additions.

drop function if exists public.accounting_create_deal(uuid, jsonb, text, numeric, numeric, text, text);

CREATE OR REPLACE FUNCTION public.accounting_create_deal(p_client_id uuid DEFAULT NULL::uuid, p_new_client jsonb DEFAULT NULL::jsonb, p_title text DEFAULT NULL::text, p_one_time numeric DEFAULT 0, p_monthly numeric DEFAULT 0, p_payment_method text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_cash_charge_vat boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_ccv boolean;
begin
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding', 'create')) then
    return jsonb_build_object('ok', false, 'errors', array['not_authorized']);
  end if;

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
  v_ccv := (v_pm = 'cash') and coalesce(p_cash_charge_vat, false);
  if v_pm is not null and v_pm not in ('cash', 'online') then
    errors := array_append(errors, 'invalid_payment_method');
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  v_code := public.generate_lead_code();

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
    if exists (
      select 1 from public.deals where client_id = v_client_id and archived = false
    ) then
      return jsonb_build_object('ok', false, 'errors', array['client_has_live_deal']);
    end if;
  end if;

  select * into v_client from public.clients where id = v_client_id;

  select id into won_stage_id
    from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id
    from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  insert into public.deals (
    client_id, title, description,
    one_time_value, recurring_monthly_value, payment_method, cash_charge_vat,
    stage_id, accounting_stage_id,
    locked_at, locked_by, actual_close_date, code
  ) values (
    v_client_id, v_title, nullif(trim(coalesce(p_description, '')), ''),
    coalesce(p_one_time, 0), coalesce(p_monthly, 0), v_pm, v_ccv,
    won_stage_id, acc_new_stage_id,
    now(), auth.uid(), current_date, v_code
  ) returning id into v_deal_id;

  insert into public.leads (
    source, title, code, stage_id, automations_enabled,
    converted_at, converted_deal_id, converted_client_id,
    company_name, contact_first_name, contact_last_name, email, phone,
    address, industry, country, vat_number, website,
    estimated_one_time_value, estimated_monthly_value, owner_user_id, cash_charge_vat
  ) values (
    'import', v_title, v_code, won_stage_id, false,
    now(), v_deal_id, v_client_id,
    v_client.name, v_client.contact_first_name, v_client.contact_last_name,
    v_client.email, v_client.phone,
    v_client.address, v_client.industry, v_client.country, v_client.vat_number, v_client.website,
    coalesce(p_one_time, 0), coalesce(p_monthly, 0), auth.uid(), v_ccv
  );

  return jsonb_build_object('ok', true, 'deal_id', v_deal_id, 'code', v_code);
end $function$;

grant execute on function public.accounting_create_deal(uuid, jsonb, text, numeric, numeric, text, text, boolean) to authenticated;

-- ROLLBACK:
--   drop function if exists public.accounting_create_deal(uuid,jsonb,text,numeric,numeric,text,text,boolean);
--   restore accounting_create_deal(uuid,jsonb,text,numeric,numeric,text,text) from 20260623170100
--     (no p_cash_charge_vat) and re-grant execute to authenticated.
