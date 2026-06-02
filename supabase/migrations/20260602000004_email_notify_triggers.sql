-- New task → email the assignee (skip self-assignment), mirroring the existing
-- in-app assigned_tasks_notify_assignee logic.
create or replace function public.email_notify_new_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare assignee_email text;
begin
  if new.assignee_user_id = new.created_by_user_id then
    return new;
  end if;
  select email into assignee_email from public.profiles where user_id = new.assignee_user_id;
  if assignee_email is null or assignee_email = '' then return new; end if;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('internal', assignee_email, 'internal_new_task',
          jsonb_build_object('title', new.title, 'deal_id', new.deal_id),
          'task:' || new.id);
  return new;
end $$;

create trigger trg_email_notify_new_task
  after insert on public.assigned_tasks
  for each row execute function public.email_notify_new_task();

-- New job → email every active member of the assigned group.
create or replace function public.email_notify_new_job()
returns trigger language plpgsql security definer set search_path = public as $$
declare m record; client_name text;
begin
  if new.assigned_group_id is null then return new; end if;
  select name into client_name from public.clients where id = new.client_id;
  for m in
    select p.email
      from public.user_groups ug
      join public.profiles p on p.user_id = ug.user_id
     where ug.group_id = new.assigned_group_id
       and p.email is not null and p.email <> ''
  loop
    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('internal', m.email, 'internal_new_job',
            jsonb_build_object('service_type', new.service_type, 'client_name', client_name, 'deal_id', new.deal_id),
            'job:' || new.id || ':' || m.email);
  end loop;
  return new;
end $$;

create trigger trg_email_notify_new_job
  after insert on public.jobs
  for each row execute function public.email_notify_new_job();

-- ROLLBACK:
-- drop trigger if exists trg_email_notify_new_task on public.assigned_tasks;
-- drop trigger if exists trg_email_notify_new_job on public.jobs;
-- drop function if exists public.email_notify_new_task();
-- drop function if exists public.email_notify_new_job();
