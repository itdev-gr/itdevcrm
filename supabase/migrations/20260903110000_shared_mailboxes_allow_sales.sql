-- The shared_mailboxes.department CHECK predates the sales@ registration
-- (2026-09-03 campaign): widen it and register sales@itdev.gr. The profile
-- was provisioned via the auth admin API (invite-flow shape) the same day.
alter table public.shared_mailboxes
  drop constraint if exists shared_mailboxes_department_check;
alter table public.shared_mailboxes
  add constraint shared_mailboxes_department_check
  check (department in ('accounting', 'support', 'sales'));

insert into public.shared_mailboxes (user_id, email, department)
select user_id, lower(email), 'sales'
  from public.profiles
 where lower(email) = 'sales@itdev.gr'
on conflict (user_id) do nothing;

-- ROLLBACK:
--   delete from public.shared_mailboxes where email = 'sales@itdev.gr';
--   alter table public.shared_mailboxes drop constraint shared_mailboxes_department_check;
--   alter table public.shared_mailboxes add constraint shared_mailboxes_department_check
--     check (department in ('accounting', 'support'));
