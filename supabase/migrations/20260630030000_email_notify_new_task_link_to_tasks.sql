-- 2026-06-30: stop sending task-assignment emails whose "Open in CRM" link
-- points at the parent deal — service-team assignees often can't see the
-- deal (RLS hides it) and the in-app bell already routes these to
-- /tasks?open=assigned:<id> (see commits b852ca2 + b4df001 + readPath in
-- src/features/notifications/notification-presenters.tsx).
--
-- Fix: the email_notify_new_task trigger now stashes task_id (and kind) in
-- the data payload. The internal_new_task template (templates.ts) reads
-- those and builds /tasks?open=assigned:<task_id>. Falls back to /tasks if
-- task_id is missing for any reason.
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
          jsonb_build_object(
            'title',   new.title,
            'task_id', new.id,
            'kind',    'assigned',
            'deal_id', new.deal_id  -- retained for back-compat / future use
          ),
          'task:' || new.id);
  return new;
end $$;

-- ROLLBACK:
-- create or replace function public.email_notify_new_task()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- declare assignee_email text;
-- begin
--   if new.assignee_user_id = new.created_by_user_id then return new; end if;
--   select email into assignee_email from public.profiles where user_id = new.assignee_user_id;
--   if assignee_email is null or assignee_email = '' then return new; end if;
--   insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
--   values ('internal', assignee_email, 'internal_new_task',
--           jsonb_build_object('title', new.title, 'deal_id', new.deal_id),
--           'task:' || new.id);
--   return new;
-- end $$;
