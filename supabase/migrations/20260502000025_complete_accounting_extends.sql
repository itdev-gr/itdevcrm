-- =============================================================================
-- complete_accounting: allow ai_seo + hosting service types when spawning jobs
-- =============================================================================
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
    errors := errors || 'services_planned_empty';
  end if;

  if d.one_time_value is null or d.one_time_value < 0 then
    errors := errors || 'invalid_one_time_value';
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  -- Spawn jobs from services_planned
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
      stage_id, assigned_group_id, status, started_at
    )
    values (
      d.id, d.client_id, service_type_val, billing_type_val,
      one_time_amt, monthly_amt, setup_fee_val,
      job_stage_id, group_id_val, 'active', now()
    );
  end loop;

  -- Move accounting stage to paid_in_full + completed metadata
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
      jsonb_build_object('deal_id', d.id, 'client_id', d.client_id)
    );
  end if;

  return jsonb_build_object('ok', true, 'deal_id', d.id);
end $$;

grant execute on function public.complete_accounting(uuid) to authenticated;
