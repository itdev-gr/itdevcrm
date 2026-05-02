-- =============================================================================
-- Add won_by_user_id to leads — records the sales person who closed the lead
-- at the moment of conversion. Set by convert_lead_to_client from auth.uid().
-- Hidden from sales by the frontend; admin sees it on the lead detail page.
-- =============================================================================
alter table public.leads
  add column if not exists won_by_user_id uuid references public.profiles(user_id);

create index if not exists leads_won_by on public.leads (won_by_user_id)
  where won_by_user_id is not null;

-- Patch convert_lead_to_client to stamp won_by_user_id at conversion time.
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
    industry, country, vat_number, website, assigned_owner_id
  ) values (
    l.company_name, l.contact_first_name, l.contact_last_name, l.email, l.phone, l.address,
    l.industry, l.country, l.vat_number, l.website, l.owner_user_id
  ) returning id into new_client_id;

  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  insert into public.deals (
    client_id, title, description, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by
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
    auth.uid()
  ) returning id into new_deal_id;

  update public.comments
    set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;

  update public.attachments
    set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;

  -- Mark lead converted + record who closed it
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
      jsonb_build_object('lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'lead_id', l.id,
    'client_id', new_client_id,
    'deal_id', new_deal_id
  );
end $$;

grant execute on function public.convert_lead_to_client(uuid) to authenticated;
