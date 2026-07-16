-- Dual-sided task resolve (spec docs/superpowers/specs/2026-07-16-dual-resolve-task-summary-design.md)
-- ROLLBACK:
--   drop function if exists public.resolve_task(text, uuid), public.unresolve_task(text, uuid);
--   drop trigger if exists user_tasks_guard_terminal on public.user_tasks;
--   drop trigger if exists assigned_tasks_guard_terminal on public.assigned_tasks;
--   drop trigger if exists user_tasks_clear_stamps on public.user_tasks;
--   drop function if exists public.tasks_guard_terminal(), public.user_tasks_clear_stamps();
--   (restore assigned_tasks_stamp_resolved from 20260512000001)
--   alter table public.user_tasks drop column if exists creator_resolved_at, drop column if exists creator_resolved_by,
--     drop column if exists assignee_resolved_at, drop column if exists assignee_resolved_by, drop column if exists summary;
--   alter table public.assigned_tasks drop column if exists creator_resolved_at, drop column if exists creator_resolved_by,
--     drop column if exists assignee_resolved_at, drop column if exists assignee_resolved_by, drop column if exists summary;

alter table public.user_tasks
  add column if not exists creator_resolved_at timestamptz,
  add column if not exists creator_resolved_by uuid,
  add column if not exists assignee_resolved_at timestamptz,
  add column if not exists assignee_resolved_by uuid,
  add column if not exists summary text;

alter table public.assigned_tasks
  add column if not exists creator_resolved_at timestamptz,
  add column if not exists creator_resolved_by uuid,
  add column if not exists assignee_resolved_at timestamptz,
  add column if not exists assignee_resolved_by uuid,
  add column if not exists summary text;

-- Direct open->terminal updates are blocked; only resolve_task()/unresolve_task()
-- (which set this transaction-local GUC) may flip the terminal state. Reopen
-- (resolved->open) stays allowed for the existing admin flow.
create or replace function public.tasks_guard_terminal() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.task_resolve_rpc', true), '') <> '1' then
    raise exception 'use resolve_task() to resolve tasks';
  end if;
  return new;
end $$;

create trigger assigned_tasks_guard_terminal
  before update on public.assigned_tasks
  for each row when (old.status = 'open' and new.status = 'resolved')
  execute function public.tasks_guard_terminal();

create trigger user_tasks_guard_terminal
  before update on public.user_tasks
  for each row when (old.completed_at is null and new.completed_at is not null)
  execute function public.tasks_guard_terminal();

-- Reopen clears both side-stamps (extends the existing assigned_tasks stamp
-- trigger; adds the user_tasks equivalent).
create or replace function public.assigned_tasks_stamp_resolved() returns trigger
language plpgsql as $$
begin
  if old.status = 'open' and new.status = 'resolved' then
    new.resolved_at := now();
    new.resolved_by_user_id := coalesce(auth.uid(), new.resolved_by_user_id);
  elsif old.status = 'resolved' and new.status = 'open' then
    new.resolved_at := null;
    new.resolved_by_user_id := null;
    new.creator_resolved_at := null;  new.creator_resolved_by := null;
    new.assignee_resolved_at := null; new.assignee_resolved_by := null;
  end if;
  return new;
end $$;

create or replace function public.user_tasks_clear_stamps() returns trigger
language plpgsql as $$
begin
  new.creator_resolved_at := null;  new.creator_resolved_by := null;
  new.assignee_resolved_at := null; new.assignee_resolved_by := null;
  return new;
end $$;

create trigger user_tasks_clear_stamps
  before update on public.user_tasks
  for each row when (old.completed_at is not null and new.completed_at is null)
  execute function public.user_tasks_clear_stamps();

create or replace function public.resolve_task(p_kind text, p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_creator uuid; v_assignee uuid;
  v_c_at timestamptz; v_a_at timestamptz;
  v_title text; v_source text; v_ptype text; v_pid uuid;
  v_is_creator boolean; v_is_assignee boolean;
  v_first_stamp boolean := false;
  v_other uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  v_admin := coalesce((select is_admin from profiles where user_id = v_uid), false);
  perform set_config('app.task_resolve_rpc', '1', true);

  if p_kind = 'assigned' then
    select created_by_user_id, assignee_user_id, creator_resolved_at, assignee_resolved_at,
           title, source_code,
           case when deal_id is not null then 'deal' else 'job' end,
           coalesce(deal_id, job_id)
      into v_creator, v_assignee, v_c_at, v_a_at, v_title, v_source, v_ptype, v_pid
      from assigned_tasks where id = p_task_id and status = 'open' for update;
  elsif p_kind = 'user' then
    select created_by, user_id, creator_resolved_at, assignee_resolved_at,
           title, null, null, null
      into v_creator, v_assignee, v_c_at, v_a_at, v_title, v_source, v_ptype, v_pid
      from user_tasks where id = p_task_id and completed_at is null for update;
  else
    raise exception 'bad kind %', p_kind;
  end if;
  if v_assignee is null and v_creator is null then raise exception 'task not found or already closed'; end if;

  v_is_creator  := coalesce(v_uid = v_creator, false);
  v_is_assignee := coalesce(v_uid = v_assignee, false);
  if not (v_is_creator or v_is_assignee or v_admin) then raise exception 'not a party'; end if;

  -- Solo tasks (no distinct creator, or creator == assignee) and admin
  -- force-close both stamp both sides; otherwise stamp own side only.
  if v_creator is null or v_creator = v_assignee then
    v_c_at := coalesce(v_c_at, now()); v_a_at := coalesce(v_a_at, now());
    v_first_stamp := false;
  elsif v_admin and not (v_is_creator or v_is_assignee) then
    v_c_at := coalesce(v_c_at, now()); v_a_at := coalesce(v_a_at, now());
    v_first_stamp := false;
  else
    if v_is_creator  and v_c_at is null then v_c_at := now(); v_first_stamp := true; end if;
    if v_is_assignee and v_a_at is null then v_a_at := now(); v_first_stamp := true; end if;
  end if;

  if p_kind = 'assigned' then
    update assigned_tasks set
      creator_resolved_at  = v_c_at,
      creator_resolved_by  = case when v_c_at is not null and creator_resolved_by  is null then v_uid else creator_resolved_by  end,
      assignee_resolved_at = v_a_at,
      assignee_resolved_by = case when v_a_at is not null and assignee_resolved_by is null then v_uid else assignee_resolved_by end,
      status = case when v_c_at is not null and v_a_at is not null then 'resolved' else status end
    where id = p_task_id;
  else
    update user_tasks set
      creator_resolved_at  = v_c_at,
      creator_resolved_by  = case when v_c_at is not null and creator_resolved_by  is null then v_uid else creator_resolved_by  end,
      assignee_resolved_at = v_a_at,
      assignee_resolved_by = case when v_a_at is not null and assignee_resolved_by is null then v_uid else assignee_resolved_by end,
      completed_at = case when v_c_at is not null and v_a_at is not null then now() else completed_at end
    where id = p_task_id;
  end if;

  -- First one-sided stamp on a two-party task -> notify the other party.
  if v_first_stamp and not (v_c_at is not null and v_a_at is not null) and v_creator <> v_assignee then
    v_other := case when v_is_creator then v_assignee else v_creator end;
    insert into notifications (user_id, type, payload) values (v_other, 'task_confirm_pending',
      jsonb_build_object('task_kind', p_kind || '_task', 'task_id', p_task_id, 'title', v_title,
                         'author_id', v_uid,
                         'author_name', (select coalesce(nullif(trim(p.full_name), ''), p.email)
                                           from profiles p where p.user_id = v_uid),
                         'source_code', v_source,
                         'parent_type', v_ptype, 'parent_id', v_pid));
  end if;

  return jsonb_build_object(
    'closed', (v_c_at is not null and v_a_at is not null),
    'your_side', case when v_is_creator and v_is_assignee then 'both'
                      when v_is_creator then 'creator' else 'assignee' end,
    'awaiting', case when v_c_at is null then v_creator when v_a_at is null then v_assignee else null end);
end $$;

create or replace function public.unresolve_task(p_kind text, p_task_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_kind = 'assigned' then
    update assigned_tasks set
      creator_resolved_at  = case when created_by_user_id  = v_uid then null else creator_resolved_at  end,
      creator_resolved_by  = case when created_by_user_id  = v_uid then null else creator_resolved_by  end,
      assignee_resolved_at = case when assignee_user_id    = v_uid then null else assignee_resolved_at end,
      assignee_resolved_by = case when assignee_user_id    = v_uid then null else assignee_resolved_by end
    where id = p_task_id and status = 'open'
      and (created_by_user_id = v_uid or assignee_user_id = v_uid);
  elsif p_kind = 'user' then
    update user_tasks set
      creator_resolved_at  = case when created_by = v_uid then null else creator_resolved_at  end,
      creator_resolved_by  = case when created_by = v_uid then null else creator_resolved_by  end,
      assignee_resolved_at = case when user_id    = v_uid then null else assignee_resolved_at end,
      assignee_resolved_by = case when user_id    = v_uid then null else assignee_resolved_by end
    where id = p_task_id and completed_at is null
      and (created_by = v_uid or user_id = v_uid);
  else
    raise exception 'bad kind %', p_kind;
  end if;
end $$;

revoke all on function public.resolve_task(text, uuid) from public, anon;
revoke all on function public.unresolve_task(text, uuid) from public, anon;
grant execute on function public.resolve_task(text, uuid) to authenticated;
grant execute on function public.unresolve_task(text, uuid) to authenticated;
