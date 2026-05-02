-- =============================================================================
-- Per-lead unique code that travels with the entity through the pipeline:
-- lead → client + deal at conversion → jobs at complete_accounting.
-- Format: L-000001, L-000002, ... — driven by a Postgres sequence so it's
-- atomic and gap-free under concurrent inserts.
-- =============================================================================
create sequence if not exists public.lead_code_seq;

create or replace function public.generate_lead_code() returns text
language sql as $$
  select 'L-' || lpad(nextval('public.lead_code_seq')::text, 6, '0');
$$;

alter table public.leads
  add column if not exists code text;
alter table public.clients
  add column if not exists code text;
alter table public.deals
  add column if not exists code text;
alter table public.jobs
  add column if not exists code text;

-- Backfill existing leads with codes
update public.leads
  set code = public.generate_lead_code()
  where code is null;

-- Default for future leads
alter table public.leads
  alter column code set default public.generate_lead_code();

-- Now make leads.code NOT NULL + unique
alter table public.leads
  alter column code set not null;
create unique index if not exists leads_code_unique on public.leads (code);

-- Index codes on downstream tables for lookup
create index if not exists clients_code on public.clients (code) where code is not null;
create index if not exists deals_code on public.deals (code) where code is not null;
create index if not exists jobs_code on public.jobs (code) where code is not null;

-- Patch convert_lead_to_client to propagate the code into client + deal.
create or replace function public.convert_lead_to_client(target_lead_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l record;
  errors text[] := '{}';
  service_count int;
  won_stage_id uuid;
  acc_new_stage_id uuid;
  new_client_id uuid;
  new_deal_id uuid;
  full_name text;
begin
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into l from public.leads where id = target_lead_id;
  if l is null then
    return jsonb_build_object('ok', false, 'errors', array['lead_not_found']);
  end if;
  if l.converted_at is not null then
    return jsonb_build_object('ok', false, 'errors', array['already_converted']);
  end if;
  if l.archived then
    return jsonb_build_object('ok', false, 'errors', array['lead_archived']);
  end if;

  if coalesce(l.estimated_one_time_value, 0) + coalesce(l.estimated_monthly_value, 0) <= 0 then
    errors := array_append(errors, 'value_required');
  end if;

  service_count := coalesce(jsonb_array_length(l.services_planned), 0);
  if service_count = 0 then
    errors := array_append(errors, 'at_least_one_service_required');
  end if;

  if l.email is null or l.email = '' then
    errors := array_append(errors, 'email_required');
  end if;

  if (l.phone is null or l.phone = '') and (l.address is null or l.address = '') then
    errors := array_append(errors, 'phone_or_address_required');
  end if;

  if l.company_name is null or trim(l.company_name) = '' then
    errors := array_append(errors, 'company_name_required');
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  insert into public.clients (
    name, contact_first_name, contact_last_name, email, phone, address,
    industry, country, vat_number, website, assigned_owner_id, code
  ) values (
    l.company_name, l.contact_first_name, l.contact_last_name, l.email, l.phone, l.address,
    l.industry, l.country, l.vat_number, l.website, l.owner_user_id, l.code
  ) returning id into new_client_id;

  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  insert into public.deals (
    client_id, title, description, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by, code
  ) values (
    new_client_id,
    coalesce(nullif(trim(l.title), ''), full_name || ' deal'),
    l.notes,
    l.owner_user_id,
    l.estimated_one_time_value,
    l.estimated_monthly_value,
    l.services_planned,
    l.expected_close_date,
    current_date,
    coalesce(won_stage_id, l.stage_id),
    acc_new_stage_id,
    now(),
    auth.uid(),
    l.code
  ) returning id into new_deal_id;

  update public.comments
    set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;

  update public.attachments
    set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;

  update public.leads
    set
      converted_at = now(),
      converted_client_id = new_client_id,
      converted_deal_id = new_deal_id,
      stage_id = coalesce(won_stage_id, stage_id),
      won_by_user_id = auth.uid()
    where id = l.id;

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (
      l.owner_user_id,
      'lead_converted',
      jsonb_build_object('lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'lead_id', l.id,
    'client_id', new_client_id,
    'deal_id', new_deal_id,
    'code', l.code
  );
end $$;

grant execute on function public.convert_lead_to_client(uuid) to authenticated;

-- Patch complete_accounting so spawned jobs inherit the deal's code.
create or replace function public.complete_accounting(target_deal_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record;
  errors text[] := '{}';
  service jsonb;
  service_type_val text;
  billing_type_val text;
  one_time_amt numeric;
  monthly_amt numeric;
  setup_fee_val numeric;
  paid_stage_id uuid;
  group_id_val uuid;
  job_stage_id uuid;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_onboarding', 'complete_accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into d from public.deals where id = target_deal_id;
  if d is null then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;
  if d.accounting_completed_at is not null then
    return jsonb_build_object('ok', false, 'errors', array['already_completed']);
  end if;
  if d.locked_at is null then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_locked']);
  end if;

  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then
    errors := array_append(errors, 'services_planned_empty');
  end if;

  if d.one_time_value is null or d.one_time_value < 0 then
    errors := array_append(errors, 'invalid_one_time_value');
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  for service in select * from jsonb_array_elements(d.services_planned)
  loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting') then
      continue;
    end if;
    if billing_type_val not in ('one_time', 'recurring_monthly') then
      continue;
    end if;
    one_time_amt := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;

    select id into group_id_val from public.groups where code = service_type_val;
    select id into job_stage_id
      from public.pipeline_stages
      where board = service_type_val
        and code = case service_type_val
          when 'web_dev' then 'awaiting_brief'
          when 'hosting' then 'setup'
          else 'onboarding'
        end
      limit 1;

    insert into public.jobs (
      deal_id, client_id, service_type, billing_type,
      one_time_amount, monthly_amount, setup_fee,
      stage_id, assigned_group_id, status, started_at, code
    )
    values (
      d.id, d.client_id, service_type_val, billing_type_val,
      one_time_amt, monthly_amt, setup_fee_val,
      job_stage_id, group_id_val, 'active', now(), d.code
    );
  end loop;

  select id into paid_stage_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;

  update public.deals
    set
      accounting_completed_at = now(),
      accounting_completed_by = auth.uid(),
      accounting_stage_id = coalesce(paid_stage_id, accounting_stage_id)
    where id = d.id;

  if d.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (
      d.owner_user_id,
      'complete_accounting',
      jsonb_build_object('deal_id', d.id, 'client_id', d.client_id, 'code', d.code)
    );
  end if;

  return jsonb_build_object('ok', true, 'deal_id', d.id, 'code', d.code);
end $$;

grant execute on function public.complete_accounting(uuid) to authenticated;
