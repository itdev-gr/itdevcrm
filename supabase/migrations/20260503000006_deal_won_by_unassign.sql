-- =============================================================================
-- - deals.won_by_user_id stamps the sales person who closed the deal at
--   conversion time. Survives owner reassignment.
-- - convert_lead_to_client now leaves deal.owner_user_id NULL so the
--   accounting team can claim the deal explicitly. won_by_user_id keeps a
--   record of the sales person regardless.
-- - assignable_owners RPC widened to include accounting-group members so the
--   deal-detail Owner picker can pick from accounting + sales + admins.
-- =============================================================================

alter table public.deals add column if not exists won_by_user_id uuid references public.profiles(user_id);

-- Backfill: copy from the linked lead if available.
update public.deals d
  set won_by_user_id = l.won_by_user_id
  from public.leads l
  where l.converted_deal_id = d.id and d.won_by_user_id is null and l.won_by_user_id is not null;

-- Extend assignable_owners to include accounting members too.
create or replace function public.assignable_owners()
returns table(user_id uuid, full_name text, email text, is_admin boolean)
language sql security definer set search_path = public stable as $$
  select p.user_id, p.full_name, p.email, p.is_admin
  from public.profiles p
  where p.is_active = true and p.archived = false
    and (
      p.is_admin = true
      or exists (
        select 1 from public.user_groups ug
        join public.groups g on g.id = ug.group_id
        where ug.user_id = p.user_id and g.code in ('sales', 'accounting')
      )
    )
  order by p.full_name;
$$;

grant execute on function public.assignable_owners() to authenticated;

-- Update convert_lead_to_client:
-- - stamp won_by_user_id on the deal
-- - leave owner_user_id NULL so accounting picks it up explicitly
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
    industry, country, vat_number, website, assigned_owner_id, code, start_date
  ) values (
    l.company_name, l.contact_first_name, l.contact_last_name, l.email, l.phone, l.address,
    l.industry, l.country, l.vat_number, l.website, null, l.code, current_date
  ) returning id into new_client_id;

  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  -- owner_user_id intentionally NULL — accounting / admin picks it up.
  insert into public.deals (
    client_id, title, description, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by, code, won_by_user_id
  ) values (
    new_client_id,
    coalesce(nullif(trim(l.title), ''), full_name || ' deal'),
    l.notes,
    null,
    l.estimated_one_time_value,
    l.estimated_monthly_value,
    l.services_planned,
    l.expected_close_date,
    current_date,
    coalesce(won_stage_id, l.stage_id),
    acc_new_stage_id,
    now(),
    auth.uid(),
    l.code,
    auth.uid()
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
