-- =============================================================================
-- Release jobs at partial_payment time, with everything except web_dev
-- starting in a "blocked" state (waiting for full payment). Admin and
-- accounting can block / unblock individual jobs manually via RPC.
--
-- Behaviour:
--   - Deal moves to partial_payment        -> jobs spawned (idempotent).
--                                              non-web_dev jobs start blocked
--                                              with reason='partial_payment_pending'.
--                                              web_dev starts unblocked.
--   - Deal moves to paid_in_full           -> complete_accounting now also
--                                              spawns any missing jobs and
--                                              clears 'partial_payment_pending'
--                                              blocks.
--   - Manual block/unblock                 -> via SECURITY DEFINER RPCs that
--                                              check is_admin OR
--                                              accounting_onboarding edit.
-- =============================================================================

-- 1. Columns ----------------------------------------------------------------

alter table public.jobs
  add column if not exists is_blocked boolean not null default false;
alter table public.jobs
  add column if not exists blocked_reason text;
alter table public.jobs
  add column if not exists blocked_at timestamptz;
alter table public.jobs
  add column if not exists blocked_by uuid references public.profiles(user_id);

create index if not exists jobs_blocked
  on public.jobs (is_blocked)
  where is_blocked = true and archived = false;

-- 2. Helper: spawn jobs from a deal's services_planned, idempotently. ------
--    `partial_payment_mode` = true  -> non-web_dev rows blocked.
--                            false -> all rows unblocked (paid in full).

create or replace function public.release_jobs_for_deal(
  target_deal_id uuid,
  partial_payment_mode boolean
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d record;
  service jsonb;
  service_type_val text;
  billing_type_val text;
  one_time_amt numeric;
  monthly_amt numeric;
  setup_fee_val numeric;
  group_id_val uuid;
  job_stage_id uuid;
  inserted int := 0;
  should_block boolean;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;

  for service in select * from jsonb_array_elements(d.services_planned)
  loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';

    if service_type_val not in
       ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting') then
      continue;
    end if;
    if billing_type_val not in ('one_time', 'recurring_monthly', 'recurring_yearly') then
      continue;
    end if;

    -- Idempotency: skip if a job for this (deal, service_type) already exists.
    if exists (
      select 1 from public.jobs
       where deal_id = d.id
         and service_type = service_type_val
         and archived = false
    ) then
      continue;
    end if;

    one_time_amt := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block := partial_payment_mode and service_type_val <> 'web_dev';

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
      stage_id, assigned_group_id, status, started_at, code,
      is_blocked, blocked_reason, blocked_at
    ) values (
      d.id, d.client_id, service_type_val, billing_type_val,
      one_time_amt, monthly_amt, setup_fee_val,
      job_stage_id, group_id_val, 'active', now(), d.code,
      should_block,
      case when should_block then 'partial_payment_pending' else null end,
      case when should_block then now() else null end
    );
    inserted := inserted + 1;
  end loop;

  return inserted;
end $$;

grant execute on function public.release_jobs_for_deal(uuid, boolean) to authenticated;

-- 3. Trigger on deals: partial_payment -> release jobs (blocking non-web_dev)

create or replace function public.deals_release_jobs_on_partial_payment()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
begin
  if new.accounting_stage_id is null
     or new.accounting_stage_id is not distinct from old.accounting_stage_id then
    return new;
  end if;

  select code into new_code
    from public.pipeline_stages
   where id = new.accounting_stage_id
     and board = 'accounting_onboarding';

  if new_code = 'partial_payment' then
    perform public.release_jobs_for_deal(new.id, true);
  end if;

  return new;
end $$;

drop trigger if exists deals_release_jobs_partial_payment on public.deals;
create trigger deals_release_jobs_partial_payment
  after update on public.deals
  for each row
  when (new.accounting_stage_id is distinct from old.accounting_stage_id)
  execute function public.deals_release_jobs_on_partial_payment();

-- 4. Patch complete_accounting: idempotent spawn + unblock partial-pending --

create or replace function public.complete_accounting(target_deal_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record;
  errors text[] := '{}';
  paid_stage_id uuid;
begin
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding', 'complete_accounting')) then
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

  -- Spawn any missing jobs (unblocked, since the deal is paid in full).
  perform public.release_jobs_for_deal(d.id, false);

  -- Clear partial_payment_pending blocks: balance is now settled.
  update public.jobs
     set is_blocked = false,
         blocked_reason = null,
         blocked_at = null,
         blocked_by = null
   where deal_id = d.id
     and is_blocked = true
     and blocked_reason = 'partial_payment_pending';

  select id into paid_stage_id
    from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;

  update public.deals
     set accounting_completed_at = now(),
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

-- 5. RPCs for manual block/unblock ------------------------------------------
--    Permission gate: admin OR accounting_onboarding edit. The RPC bypasses
--    RLS so accounting users keep zero direct mutate access on the jobs table.

create or replace function public.block_job(target_job_id uuid, reason text default 'manual')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  j record;
begin
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding', 'edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into j from public.jobs where id = target_job_id;
  if j is null then
    return jsonb_build_object('ok', false, 'errors', array['job_not_found']);
  end if;

  update public.jobs
     set is_blocked = true,
         blocked_reason = coalesce(reason, 'manual'),
         blocked_at = now(),
         blocked_by = auth.uid()
   where id = target_job_id;

  return jsonb_build_object('ok', true, 'job_id', target_job_id);
end $$;

create or replace function public.unblock_job(target_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  j record;
begin
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding', 'edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into j from public.jobs where id = target_job_id;
  if j is null then
    return jsonb_build_object('ok', false, 'errors', array['job_not_found']);
  end if;

  update public.jobs
     set is_blocked = false,
         blocked_reason = null,
         blocked_at = null,
         blocked_by = null
   where id = target_job_id;

  return jsonb_build_object('ok', true, 'job_id', target_job_id);
end $$;

grant execute on function public.block_job(uuid, text) to authenticated;
grant execute on function public.unblock_job(uuid) to authenticated;
