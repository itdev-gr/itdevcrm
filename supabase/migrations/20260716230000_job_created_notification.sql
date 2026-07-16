-- =============================================================================
-- 20260716230000_job_created_notification.sql
-- New job → fan out an in-app `job_created` notification to every active member
-- of the job's department (NEW.assigned_group_id). Mirrors the member-selection
-- query in email_notify_new_job() (20260602000004_email_notify_triggers.sql:31-36)
-- but inserts `notifications` rows instead of emails.
--
-- The payload carries parent_type='job' + target_job_id so a dept member (who
-- may lack RLS on the parent deal) deep-links straight to /jobs/<id> — the same
-- pattern used by task notifications (20260630000000_task_notif_target_job.sql).
--
-- The actor (auth.uid()) is skipped: under the SECURITY DEFINER deal-close RPC
-- auth.uid() is the deal-closer, so this avoids self-notifying. Harmless if null.
-- =============================================================================

create or replace function public.jobs_notify_group()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_client_name text;
begin
  if new.assigned_group_id is null then
    return new;
  end if;

  select name into v_client_name from public.clients where id = new.client_id;

  -- Recipients = active members of the job's department UNION all active admins
  -- (admins aren't department members but the owner wants to see every new job),
  -- minus the actor who created the job.
  for m in
    select r.user_id from (
      select p.user_id
        from public.user_groups ug
        join public.profiles p on p.user_id = ug.user_id
       where ug.group_id = new.assigned_group_id
         and p.is_active and p.email is not null and p.email <> ''
      union
      select p.user_id
        from public.profiles p
       where p.is_admin
         and p.is_active and p.email is not null and p.email <> ''
    ) r
    where r.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      m.user_id,
      'job_created',
      jsonb_build_object(
        'job_id', new.id,
        'service_type', new.service_type,
        'client_name', v_client_name,
        'target_job_id', new.id,
        'parent_type', 'job',
        'parent_id', new.id
      )
    );
  end loop;

  return new;
end $$;

create trigger jobs_notify_group
  after insert on public.jobs
  for each row execute function public.jobs_notify_group();

-- =============================================================================
-- ROLLBACK:
--   drop trigger if exists jobs_notify_group on public.jobs;
--   drop function if exists public.jobs_notify_group();
-- =============================================================================
