-- Assignees can no longer delete tasks delegated to them (deletion bypassed
-- dual-resolve). Creator keeps delete; assignee keeps delete on personal/self
-- tasks (created_by null or self). Admin unchanged (no admin branch existed).
-- The TaskDialog delete button mirrors this rule via canDeleteUserTask().
--
-- ROLLBACK:
--   alter policy user_tasks_delete on public.user_tasks
--     using ((( select auth.uid()) = user_id) or (( select auth.uid()) = created_by));

alter policy user_tasks_delete on public.user_tasks
  using (
    (( select auth.uid()) = created_by)
    or (
      (( select auth.uid()) = user_id)
      and (created_by is null or created_by = user_id)
    )
  );
