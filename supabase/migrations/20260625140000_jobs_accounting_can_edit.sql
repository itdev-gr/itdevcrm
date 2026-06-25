-- Let the accounting team edit jobs directly (stage, owner, title, Info tab, archive).
-- Today jobs UPDATE is limited to admins or the owning service team
-- (policy jobs_mutate_admin_or_service: admin OR current_user_can(service_type,'edit')).
-- This adds an ADDITIVE, UPDATE-ONLY policy for accounting. It does NOT grant
-- insert or delete (hard delete stays admin-only via delete_jobs). Billing edits
-- already work for accounting through the update_job_billing RPC.
--
-- ROLLBACK:
--   drop policy if exists jobs_update_accounting on public.jobs;

create policy jobs_update_accounting on public.jobs
  for update
  to authenticated
  using (public.current_user_can('accounting_onboarding', 'edit'))
  with check (public.current_user_can('accounting_onboarding', 'edit'));
