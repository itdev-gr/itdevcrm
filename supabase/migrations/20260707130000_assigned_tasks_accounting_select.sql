-- Admin + accounting must see ALL tasks on a deal. Admins already pass the
-- assigned_tasks SELECT policy; accounting members only saw tasks they created
-- or were assigned. Read-only widening: UPDATE/DELETE policies and the
-- task_comments / is_task_party rules are intentionally unchanged.

drop policy if exists assigned_tasks_select on public.assigned_tasks;
create policy assigned_tasks_select on public.assigned_tasks
  for select to authenticated
  using (
    auth.uid() = assignee_user_id
    or auth.uid() = created_by_user_id
    or public.current_user_is_admin()
    or public.current_user_in_group('accounting')
  );

-- ROLLBACK:
-- drop policy if exists assigned_tasks_select on public.assigned_tasks;
-- create policy assigned_tasks_select on public.assigned_tasks
--   for select to authenticated
--   using (
--     auth.uid() = assignee_user_id
--     or auth.uid() = created_by_user_id
--     or public.current_user_is_admin()
--   );
