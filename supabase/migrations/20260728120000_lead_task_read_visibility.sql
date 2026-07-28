-- =============================================================================
-- Lead task & conversation READ visibility for lead-visible users.
-- Spec: docs/superpowers/specs/2026-07-28-lead-task-read-visibility-design.md
--
-- Whoever can open a lead (owner rep; admins already pass everywhere) can now
-- READ all user_tasks linked to it, their task_comments threads, and the
-- files inside those threads. Strictly read-only: every INSERT/UPDATE/DELETE
-- policy is untouched, so commenting/resolving/editing stays parties-only.
-- =============================================================================

create or replace function public.can_read_task(p_user_task uuid, p_assigned_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_task_party(p_user_task, p_assigned_task)
    or (p_user_task is not null and exists (
          select 1
            from public.user_tasks ut
            join public.leads l on l.id = ut.lead_id
           where ut.id = p_user_task
             and l.owner_user_id = auth.uid()));
$$;

revoke all on function public.can_read_task(uuid, uuid) from public;
grant execute on function public.can_read_task(uuid, uuid) to authenticated;

drop policy if exists user_tasks_select on public.user_tasks;
create policy user_tasks_select on public.user_tasks
  for select to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = created_by
    or public.current_user_is_admin()
    or (lead_id is not null and exists (
          select 1 from public.leads l
          where l.id = user_tasks.lead_id and l.owner_user_id = auth.uid()))
  );

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select to authenticated
  using (public.can_read_task(user_task_id, assigned_task_id));

drop policy if exists comment_attachments_select on public.comment_attachments;
create policy comment_attachments_select on public.comment_attachments
  for select to authenticated
  using (
    comment_id is not null  -- general comments stay visible to all staff
    or exists (
      select 1 from public.task_comments tc
       where tc.id = comment_attachments.task_comment_id
         and public.can_read_task(tc.user_task_id, tc.assigned_task_id)));

-- ROLLBACK:
-- drop policy if exists user_tasks_select on public.user_tasks;
-- create policy user_tasks_select on public.user_tasks
--   for select to authenticated
--   using (auth.uid() = user_id or auth.uid() = created_by or public.current_user_is_admin());
-- drop policy if exists task_comments_select on public.task_comments;
-- create policy task_comments_select on public.task_comments
--   for select to authenticated
--   using (public.is_task_party(user_task_id, assigned_task_id));
-- drop policy if exists comment_attachments_select on public.comment_attachments;
-- create policy comment_attachments_select on public.comment_attachments
--   for select to authenticated
--   using (comment_id is not null or exists (
--     select 1 from public.task_comments tc
--      where tc.id = comment_attachments.task_comment_id
--        and public.is_task_party(tc.user_task_id, tc.assigned_task_id)));
-- drop function if exists public.can_read_task(uuid, uuid);
