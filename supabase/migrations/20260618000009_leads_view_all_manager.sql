-- Sales managers (granted sales/view_all) + admins can see ALL leads (incl.
-- unassigned) on the leads management page; sales reps stay own-only. The
-- pipeline kanban still shows reps only their own (enforced in the UI), so this
-- only broadens the leads table / API visibility for managers.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view_all')
    or owner_user_id = auth.uid()
  );

-- Grant the manager capability to the sales manager (per-user override).
delete from public.user_permissions up
  using public.profiles p
 where p.email = 'tvogiatzi@itdev.gr'
   and up.user_id = p.user_id and up.board = 'sales' and up.action = 'view_all';
insert into public.user_permissions (user_id, board, action, scope, allowed)
select p.user_id, 'sales', 'view_all', 'all', true
  from public.profiles p where p.email = 'tvogiatzi@itdev.gr';

-- ROLLBACK:
-- delete from public.user_permissions up using public.profiles p
--  where p.email='tvogiatzi@itdev.gr' and up.user_id=p.user_id
--    and up.board='sales' and up.action='view_all';
-- drop policy if exists leads_select on public.leads;
-- create policy leads_select on public.leads for select to authenticated
--   using (public.current_user_is_admin() or owner_user_id = auth.uid());
