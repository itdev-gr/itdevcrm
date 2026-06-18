-- Sales reps must see ONLY their own leads in the pipeline. Remove the broad
-- sales:view visibility from the leads SELECT policy: non-admins now see only
-- leads where owner_user_id = themselves. Admins still see all. The sales:view
-- permission itself is unchanged (it still gates sales board access / deals).
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (public.current_user_is_admin() or owner_user_id = auth.uid());

-- ROLLBACK:
-- drop policy if exists leads_select on public.leads;
-- create policy leads_select on public.leads for select to authenticated
--   using (public.current_user_is_admin() or public.current_user_can('sales','view') or owner_user_id = auth.uid());
