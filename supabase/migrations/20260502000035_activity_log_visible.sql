-- =============================================================================
-- Make activity_log visible to authenticated users (not just admin) so the
-- ActivityPanel on lead / client / deal detail pages actually has data to
-- render for sales people. Admins still see everything by virtue of RLS
-- bypass via current_user_is_admin().
-- =============================================================================
drop policy if exists activity_log_select_admin on public.activity_log;

create policy activity_log_select_authenticated
  on public.activity_log for select
  to authenticated
  using (true);
