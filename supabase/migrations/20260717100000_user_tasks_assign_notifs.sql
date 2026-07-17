-- Delegated personal-task creation notifies the assignee (in-app + email),
-- mirroring assigned_tasks_notify_assignee + email_notify_new_task.
-- Frontend needs no change: readPath() routes task_kind 'user_task' to
-- /tasks?open=user:<id>, and the internal_new_task email template already
-- branches on kind==='user'.
--
-- ROLLBACK:
--   drop trigger if exists user_tasks_notify_assignee on public.user_tasks;
--   drop function if exists public.user_tasks_notify_assignee();
--   drop trigger if exists user_tasks_email_notify_new_task on public.user_tasks;
--   drop function if exists public.user_tasks_email_notify_new_task();

create or replace function public.user_tasks_notify_assignee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.created_by is null or new.created_by = new.user_id then
    return new;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (
    new.user_id,
    'task_assigned',
    jsonb_build_object(
      'task_kind', 'user_task',
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', new.created_by,
      'title', new.title
    )
  );
  return new;
end $$;

drop trigger if exists user_tasks_notify_assignee on public.user_tasks;
create trigger user_tasks_notify_assignee
after insert on public.user_tasks
for each row execute function public.user_tasks_notify_assignee();

create or replace function public.user_tasks_email_notify_new_task()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare assignee_email text;
begin
  if new.created_by is null or new.created_by = new.user_id then
    return new;
  end if;
  select email into assignee_email from public.profiles where user_id = new.user_id;
  if assignee_email is null or assignee_email = '' then return new; end if;
  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('internal', assignee_email, 'internal_new_task',
          jsonb_build_object(
            'title',   new.title,
            'task_id', new.id,
            'kind',    'user'
          ),
          'task:' || new.id);
  return new;
end $$;

drop trigger if exists user_tasks_email_notify_new_task on public.user_tasks;
create trigger user_tasks_email_notify_new_task
after insert on public.user_tasks
for each row execute function public.user_tasks_email_notify_new_task();
