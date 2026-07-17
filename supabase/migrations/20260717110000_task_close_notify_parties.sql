-- On the final close of a task, notify every party except the closer:
--  * creator  — when not null, not the assignee, and not the closer
--  * assignee — when not the closer (or the closer is unknown)
-- Covers: creator closes second -> assignee now notified; admin force-close ->
-- both parties notified; self tasks stay silent unless a third-party admin
-- closes them (then the owner is notified). The previous behavior (creator
-- notified when the assignee closes) is preserved. Trigger definitions are
-- untouched — only the function bodies change.
--
-- ROLLBACK — restore the previous bodies (verbatim, captured via
-- pg_get_functiondef on 2026-07-17):
--
-- create or replace function public.user_tasks_notify_creator()
-- returns trigger language plpgsql security definer set search_path to 'public'
-- as $fn$
-- begin
--   if new.completed_at is null or old.completed_at is not null then
--     return new;
--   end if;
--   if new.created_by is null
--      or new.created_by = new.user_id
--      or new.created_by = auth.uid() then
--     return new;
--   end if;
--   insert into public.notifications (user_id, type, payload)
--   values (
--     new.created_by,
--     'task_resolved',
--     jsonb_build_object(
--       'task_id', new.id,
--       'parent_type', 'user_task',
--       'parent_id', new.id,
--       'author_id', new.user_id,
--       'title', new.title
--     )
--   );
--   return new;
-- end $fn$;
--
-- create or replace function public.assigned_tasks_notify_creator()
-- returns trigger language plpgsql security definer set search_path to 'public'
-- as $fn$
-- declare
--   v_parent_type text;
--   v_parent_id uuid;
--   v_target_job_id uuid;
-- begin
--   if new.status <> 'resolved' or old.status = 'resolved' then return new; end if;
--   if new.created_by_user_id = coalesce(new.resolved_by_user_id, auth.uid()) then
--     return new;
--   end if;
--   if new.deal_id is not null then
--     v_parent_type := 'deal'; v_parent_id := new.deal_id;
--   else
--     v_parent_type := 'job';  v_parent_id := new.job_id;
--   end if;
--   v_target_job_id := public.task_target_job_id(new.deal_id, new.job_id, new.department_group_id);
--   insert into public.notifications (user_id, type, payload)
--   values (
--     new.created_by_user_id,
--     'task_resolved',
--     jsonb_build_object(
--       'task_id', new.id,
--       'parent_type', v_parent_type,
--       'parent_id', v_parent_id,
--       'author_id', coalesce(new.resolved_by_user_id, auth.uid()),
--       'title', new.title,
--       'source_code', new.source_code,
--       'target_job_id', v_target_job_id
--     )
--   );
--   return new;
-- end $fn$;

create or replace function public.user_tasks_notify_creator()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.user_id);
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;
  if new.created_by is not null
     and new.created_by <> new.user_id
     and new.created_by <> v_actor then
    insert into public.notifications (user_id, type, payload)
    values (new.created_by, 'task_resolved', jsonb_build_object(
      'task_kind', 'user_task',
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', v_actor,
      'title', new.title));
  end if;
  if new.user_id <> v_actor then
    insert into public.notifications (user_id, type, payload)
    values (new.user_id, 'task_resolved', jsonb_build_object(
      'task_kind', 'user_task',
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', v_actor,
      'title', new.title));
  end if;
  return new;
end $$;

create or replace function public.assigned_tasks_notify_creator()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid;
  v_parent_type text;
  v_parent_id uuid;
  v_target_job_id uuid;
  v_payload jsonb;
begin
  if new.status <> 'resolved' or old.status = 'resolved' then return new; end if;
  v_actor := coalesce(new.resolved_by_user_id, auth.uid());
  if new.deal_id is not null then
    v_parent_type := 'deal'; v_parent_id := new.deal_id;
  else
    v_parent_type := 'job';  v_parent_id := new.job_id;
  end if;
  v_target_job_id := public.task_target_job_id(new.deal_id, new.job_id, new.department_group_id);
  v_payload := jsonb_build_object(
    'task_kind', 'assigned_task',
    'task_id', new.id,
    'parent_type', v_parent_type,
    'parent_id', v_parent_id,
    'author_id', v_actor,
    'title', new.title,
    'source_code', new.source_code,
    'target_job_id', v_target_job_id);
  if new.created_by_user_id is not null
     and new.created_by_user_id <> new.assignee_user_id
     and (v_actor is null or new.created_by_user_id <> v_actor) then
    insert into public.notifications (user_id, type, payload)
    values (new.created_by_user_id, 'task_resolved', v_payload);
  end if;
  if v_actor is null or new.assignee_user_id <> v_actor then
    insert into public.notifications (user_id, type, payload)
    values (new.assignee_user_id, 'task_resolved', v_payload);
  end if;
  return new;
end $$;
