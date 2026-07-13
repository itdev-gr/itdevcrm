-- 2026-07-13: job Emails failsafe (owner direction): a job page shows, besides
-- job-coded mail, the deal's mail whose department matches the job's service
-- OR whose staff party BELONGS to the job's service group — so e.g. an email
-- to mkifokeris (web_dev member) surfaces on the deal's Web Dev job even when
-- the sender forgot the -WEBDEV code in the subject.
--
-- group_member_ids is SECURITY DEFINER because user_groups is self-or-admin
-- readable; it exposes only membership ids (same class as profile_directory).
-- job_emails stays SECURITY INVOKER so email_messages/jobs RLS applies to the
-- caller — department silos are NOT widened by this (a viewer still only sees
-- rows their groups may see; admins see all).
create or replace function public.group_member_ids(p_code text)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select ug.user_id
    from user_groups ug join groups g on g.id = ug.group_id
   where g.code = p_code;
$$;
revoke execute on function public.group_member_ids(text) from public, anon;
grant execute on function public.group_member_ids(text) to authenticated;

create or replace function public.job_emails(p_job_id uuid)
returns setof public.email_messages
language sql stable security invoker set search_path = public as $$
  select em.*
    from email_messages em
    join jobs j on j.id = p_job_id
   where em.job_id = j.id
      or (em.deal_id is not null and em.deal_id = j.deal_id
          and (em.department = j.service_type
               or em.staff_user_id in (select group_member_ids(j.service_type))))
   order by em.sent_at asc;
$$;
revoke execute on function public.job_emails(uuid) from public, anon;
grant execute on function public.job_emails(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ROLLBACK:
--   drop function if exists public.job_emails(uuid);
--   drop function if exists public.group_member_ids(text);
