-- supabase/migrations/20260622280000_user_tasks_notify_creator.sql
-- =============================================================================
-- Notify the CREATOR of a personal (user_tasks) task when its assignee completes
-- it. Mirrors assigned_tasks_notify_creator. In-app bell only (type
-- 'task_resolved'); parent_type 'user_task' so readPath() links it to /tasks.
-- Suppressed when the creator completes their own task (created_by = user_id)
-- or when created_by is null (legacy rows).
-- =============================================================================

create or replace function public.user_tasks_notify_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- fire only on the transition open -> completed
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;
  -- only when someone else created the task for this user
  if new.created_by is null or new.created_by = new.user_id then
    return new;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (
    new.created_by,
    'task_resolved',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', new.user_id,
      'title', new.title
    )
  );
  return new;
end $$;

drop trigger if exists user_tasks_notify_creator on public.user_tasks;
create trigger user_tasks_notify_creator
  after update of completed_at on public.user_tasks
  for each row execute function public.user_tasks_notify_creator();

-- ---------------------------------------------------------------------------
-- Rollback:
--   drop trigger if exists user_tasks_notify_creator on public.user_tasks;
--   drop function if exists public.user_tasks_notify_creator();
-- ---------------------------------------------------------------------------
