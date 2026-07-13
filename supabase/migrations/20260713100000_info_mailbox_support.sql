-- 2026-07-13: info@itdev.gr mail belongs to Technical (owner direction). The
-- profile is group-less so the uncoded rule defaulted it to Sales; registering
-- it as a shared mailbox with department 'support' routes it to the Technical
-- bucket (visible to all Technical-umbrella groups) via the registry override
-- that already runs first in resolve_email_filing. Side effects (intended):
-- appears on Settings→Shared mailboxes (connectable later, 90d paged backfill
-- if connected); lead-matched mail keeps department 'sales' (lead branch
-- ignores the registry by design).
insert into public.shared_mailboxes (user_id, email, department)
select user_id, lower(email), 'support'
  from public.profiles
 where lower(email) = 'info@itdev.gr'
on conflict (user_id) do nothing;

-- One-off retag of its uncoded, non-lead mail.
update public.email_messages em set department = 'support'
  from public.profiles p
 where p.user_id = em.staff_user_id and lower(p.email) = 'info@itdev.gr'
   and em.department = 'sales' and em.job_id is null and em.lead_id is null;

-- ROLLBACK:
--   delete from public.shared_mailboxes where email = 'info@itdev.gr';
--   update public.email_messages em set department = 'sales'
--     from public.profiles p
--    where p.user_id = em.staff_user_id and lower(p.email) = 'info@itdev.gr'
--      and em.department = 'support' and em.job_id is null and em.lead_id is null;
