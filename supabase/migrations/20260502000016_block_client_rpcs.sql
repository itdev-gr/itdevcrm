-- =============================================================================
-- Phase 5 migration: block_client / unblock_client RPCs + jobs RLS soft-block
-- =============================================================================

-- ---------------------------------------------------------------------------
-- helper: is_client_blocked(client_id) -> bool
-- ---------------------------------------------------------------------------
create or replace function public.is_client_blocked(target_client_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_blocks
    where client_id = target_client_id
      and unblocked_at is null
  );
$$;

grant execute on function public.is_client_blocked(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- block_client(client_id, reason)
-- ---------------------------------------------------------------------------
create or replace function public.block_client(target_client_id uuid, reason_text text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c record;
  block_id uuid;
begin
  if not (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'block_client')
    or public.current_user_can('accounting_onboarding', 'block_client')
  ) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  if reason_text is null or length(trim(reason_text)) = 0 then
    return jsonb_build_object('ok', false, 'errors', array['reason_required']);
  end if;

  select * into c from public.clients where id = target_client_id;
  if c is null then
    return jsonb_build_object('ok', false, 'errors', array['client_not_found']);
  end if;

  if public.is_client_blocked(target_client_id) then
    return jsonb_build_object('ok', false, 'errors', array['already_blocked']);
  end if;

  insert into public.client_blocks (client_id, blocked_by, reason)
  values (target_client_id, auth.uid(), trim(reason_text))
  returning id into block_id;

  return jsonb_build_object('ok', true, 'block_id', block_id);
end $$;

grant execute on function public.block_client(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- unblock_client(client_id)
-- ---------------------------------------------------------------------------
create or replace function public.unblock_client(target_client_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  active_block record;
begin
  if not (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'unblock_client')
    or public.current_user_can('accounting_onboarding', 'unblock_client')
  ) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into active_block
  from public.client_blocks
  where client_id = target_client_id and unblocked_at is null
  limit 1;

  if active_block is null then
    return jsonb_build_object('ok', false, 'errors', array['not_blocked']);
  end if;

  update public.client_blocks
    set unblocked_at = now(), unblocked_by = auth.uid()
    where id = active_block.id;

  return jsonb_build_object('ok', true, 'block_id', active_block.id);
end $$;

grant execute on function public.unblock_client(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- jobs RLS soft-block: re-create the existing jobs_mutate_admin_or_service
-- policy unchanged (no semantic change here). The actual stage-move prevention
-- happens via a row-level BEFORE UPDATE trigger below.
-- ---------------------------------------------------------------------------
drop policy if exists jobs_mutate_admin_or_service on public.jobs;

create policy jobs_mutate_admin_or_service
  on public.jobs for all
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  );

-- For move_stage prevention while blocked, we use a row-level trigger that
-- raises an exception when stage_id changes on a blocked client's job.
-- (RLS WITH CHECK can't easily compare OLD vs NEW values; a BEFORE UPDATE
-- trigger is the right tool.)
create or replace function public.enforce_no_stage_move_when_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.stage_id is distinct from new.stage_id then
    if public.is_client_blocked(new.client_id) and not public.current_user_is_admin() then
      raise exception 'client_blocked' using errcode = 'P0001', hint = 'unblock_client_first';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists jobs_no_stage_move_when_blocked on public.jobs;
create trigger jobs_no_stage_move_when_blocked
  before update on public.jobs
  for each row execute function public.enforce_no_stage_move_when_blocked();
