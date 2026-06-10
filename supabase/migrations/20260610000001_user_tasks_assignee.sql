-- =============================================================================
-- user_tasks: allow assigning a calendar task to a colleague.
--
-- user_id stays the assignee (whose calendar the task lands on); created_by
-- records who created it. RLS widens so the creator can also see and edit a
-- task they assigned to someone else.
--
-- Rollback:
--   drop policy user_tasks_insert on public.user_tasks;
--   drop policy user_tasks_update on public.user_tasks;
--   drop policy user_tasks_delete on public.user_tasks;
--   drop policy user_tasks_select on public.user_tasks;
--   create policy user_tasks_select on public.user_tasks
--     for select to authenticated
--     using (auth.uid() = user_id or public.current_user_is_admin());
--   create policy user_tasks_mutate_own on public.user_tasks
--     for all to authenticated
--     using (auth.uid() = user_id)
--     with check (auth.uid() = user_id);
--   alter table public.user_tasks drop column created_by;
-- =============================================================================

alter table public.user_tasks
  add column created_by uuid references public.profiles(user_id) on delete set null;

-- Existing rows were self-created.
update public.user_tasks set created_by = user_id where created_by is null;

drop policy user_tasks_select on public.user_tasks;
drop policy user_tasks_mutate_own on public.user_tasks;

create policy user_tasks_select on public.user_tasks
  for select to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = created_by
    or public.current_user_is_admin()
  );

-- You can create a task on your own calendar, or assign one to a colleague —
-- but then you must stamp yourself as the creator.
create policy user_tasks_insert on public.user_tasks
  for insert to authenticated
  with check (auth.uid() = user_id or auth.uid() = created_by);

create policy user_tasks_update on public.user_tasks
  for update to authenticated
  using (auth.uid() = user_id or auth.uid() = created_by)
  with check (auth.uid() = user_id or auth.uid() = created_by);

create policy user_tasks_delete on public.user_tasks
  for delete to authenticated
  using (auth.uid() = user_id or auth.uid() = created_by);
