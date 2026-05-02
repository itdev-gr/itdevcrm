-- =============================================================================
-- Phase 3 migration: lock_deal() RPC
-- =============================================================================

create or replace function public.lock_deal(target_deal_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record;
  c record;
  errors text[] := '{}';
  contract_count int;
  job_count int;
  won_stage_id uuid;
begin
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into d from public.deals where id = target_deal_id;
  if d is null then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;
  if d.locked_at is not null then
    return jsonb_build_object('ok', false, 'errors', array['already_locked']);
  end if;

  select * into c from public.clients where id = d.client_id;
  if c is null then
    errors := errors || 'client_missing';
  end if;

  if coalesce(d.one_time_value, 0) + coalesce(d.recurring_monthly_value, 0) <= 0 then
    errors := errors || 'value_required';
  end if;

  select count(*) into job_count from public.jobs where deal_id = d.id and archived = false;
  if job_count = 0 then
    errors := errors || 'at_least_one_job_required';
  end if;

  if c is not null then
    if c.email is null or c.email = '' then
      errors := errors || 'client_email_required';
    end if;
    if (c.phone is null or c.phone = '') and (c.address is null or c.address = '') then
      errors := errors || 'client_phone_or_address_required';
    end if;
  end if;

  select count(*) into contract_count
  from public.attachments
  where parent_type = 'deal' and parent_id = d.id and kind = 'contract' and archived = false;
  if contract_count = 0 then
    errors := errors || 'contract_attachment_required';
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;

  update public.deals
    set
      locked_at = now(),
      locked_by = auth.uid(),
      actual_close_date = current_date,
      stage_id = coalesce(won_stage_id, stage_id)
    where id = d.id;

  if d.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (
      d.owner_user_id,
      'lock_deal',
      jsonb_build_object('deal_id', d.id, 'client_id', d.client_id)
    );
  end if;

  return jsonb_build_object('ok', true, 'deal_id', d.id);
end $$;

grant execute on function public.lock_deal(uuid) to authenticated;
