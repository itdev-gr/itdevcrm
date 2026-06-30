-- =============================================================================
-- 20260630000000_task_notif_target_job.sql
-- Route task notifications to the matching service job so dept users (who lack
-- RLS access to the parent deal) can open them. Adds payload.target_job_id and
-- backfills unread task_assigned / task_resolved notifications.
-- =============================================================================

-- ---------- Helper: resolve a deal-task to its dept-matched job --------------
create or replace function public.task_target_job_id(
  p_deal_id uuid,
  p_job_id uuid,
  p_department_group_id uuid
) returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_job_id,
    (
      select j.id
      from public.jobs j
      join public.groups g on g.id = p_department_group_id
      where p_deal_id is not null
        and p_department_group_id is not null
        and j.deal_id = p_deal_id
        and j.service_type = g.code
      order by j.created_at asc
      limit 1
    )
  );
$$;

revoke all on function public.task_target_job_id(uuid, uuid, uuid) from public, anon;
grant execute on function public.task_target_job_id(uuid, uuid, uuid) to authenticated, service_role;

-- ---------- Replace the assignee-notify trigger ------------------------------
create or replace function public.assigned_tasks_notify_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_type text;
  v_parent_id uuid;
  v_target_job_id uuid;
begin
  if new.assignee_user_id = new.created_by_user_id then
    return new;
  end if;
  if new.deal_id is not null then
    v_parent_type := 'deal'; v_parent_id := new.deal_id;
  else
    v_parent_type := 'job';  v_parent_id := new.job_id;
  end if;
  v_target_job_id := public.task_target_job_id(new.deal_id, new.job_id, new.department_group_id);
  insert into public.notifications (user_id, type, payload)
  values (
    new.assignee_user_id,
    'task_assigned',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', v_parent_type,
      'parent_id', v_parent_id,
      'author_id', new.created_by_user_id,
      'title', new.title,
      'source_code', new.source_code,
      'target_job_id', v_target_job_id
    )
  );
  return new;
end $$;

-- ---------- Replace the creator-notify trigger -------------------------------
create or replace function public.assigned_tasks_notify_creator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_type text;
  v_parent_id uuid;
  v_target_job_id uuid;
begin
  if new.status <> 'resolved' or old.status = 'resolved' then return new; end if;
  if new.created_by_user_id = coalesce(new.resolved_by_user_id, auth.uid()) then
    return new;
  end if;
  if new.deal_id is not null then
    v_parent_type := 'deal'; v_parent_id := new.deal_id;
  else
    v_parent_type := 'job';  v_parent_id := new.job_id;
  end if;
  v_target_job_id := public.task_target_job_id(new.deal_id, new.job_id, new.department_group_id);
  insert into public.notifications (user_id, type, payload)
  values (
    new.created_by_user_id,
    'task_resolved',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', v_parent_type,
      'parent_id', v_parent_id,
      'author_id', coalesce(new.resolved_by_user_id, auth.uid()),
      'title', new.title,
      'source_code', new.source_code,
      'target_job_id', v_target_job_id
    )
  );
  return new;
end $$;

-- ---------- Backfill: add target_job_id to existing unread task notifs ------
-- Only unread (read_at is null) — already-read notifs don't need rerouting.
update public.notifications n
set payload = n.payload || jsonb_build_object('target_job_id', t.target_job_id)
from (
  select
    a.id as task_id,
    public.task_target_job_id(a.deal_id, a.job_id, a.department_group_id) as target_job_id
  from public.assigned_tasks a
) t
where n.read_at is null
  and n.type in ('task_assigned', 'task_resolved')
  and (n.payload ->> 'task_id')::uuid = t.task_id
  and t.target_job_id is not null
  and not (n.payload ? 'target_job_id');

-- =============================================================================
-- Revert SQL (apply manually to roll back):
-- =============================================================================
--   -- Restore prior trigger bodies from 20260512000001_assigned_tasks.sql:108-177
--
--   create or replace function public.assigned_tasks_notify_assignee()
--   returns trigger language plpgsql security definer set search_path = public as $$
--   declare
--     parent_type text;
--     parent_id uuid;
--   begin
--     if new.assignee_user_id = new.created_by_user_id then
--       return new;
--     end if;
--     if new.deal_id is not null then
--       parent_type := 'deal'; parent_id := new.deal_id;
--     else
--       parent_type := 'job';  parent_id := new.job_id;
--     end if;
--     insert into public.notifications (user_id, type, payload)
--     values (
--       new.assignee_user_id,
--       'task_assigned',
--       jsonb_build_object(
--         'task_id', new.id,
--         'parent_type', parent_type,
--         'parent_id', parent_id,
--         'author_id', new.created_by_user_id,
--         'title', new.title,
--         'source_code', new.source_code
--       )
--     );
--     return new;
--   end $$;
--
--   create or replace function public.assigned_tasks_notify_creator()
--   returns trigger language plpgsql security definer set search_path = public as $$
--   declare
--     parent_type text;
--     parent_id uuid;
--   begin
--     if new.status <> 'resolved' or old.status = 'resolved' then return new; end if;
--     if new.created_by_user_id = coalesce(new.resolved_by_user_id, auth.uid()) then
--       return new;
--     end if;
--     if new.deal_id is not null then
--       parent_type := 'deal'; parent_id := new.deal_id;
--     else
--       parent_type := 'job';  parent_id := new.job_id;
--     end if;
--     insert into public.notifications (user_id, type, payload)
--     values (
--       new.created_by_user_id,
--       'task_resolved',
--       jsonb_build_object(
--         'task_id', new.id,
--         'parent_type', parent_type,
--         'parent_id', parent_id,
--         'author_id', coalesce(new.resolved_by_user_id, auth.uid()),
--         'title', new.title,
--         'source_code', new.source_code
--       )
--     );
--     return new;
--   end $$;
--
--   -- Strip the new payload key (idempotent):
--   update public.notifications
--      set payload = payload - 'target_job_id'
--    where type in ('task_assigned','task_resolved')
--      and payload ? 'target_job_id';
--
--   drop function if exists public.task_target_job_id(uuid, uuid, uuid);
