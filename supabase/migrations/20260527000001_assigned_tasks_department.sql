-- =============================================================================
-- assigned_tasks.department_group_id — required single-department tag on each
-- assigned task, picked at creation time. Replaces the previously-considered
-- many-to-many design after user feedback ("one department per task").
--
-- The column is added nullable first so existing rows survive, the lone
-- backfill update lives inline (only one row exists in production at the time
-- of this migration), and the column is then flipped to NOT NULL in the same
-- file.
--
-- ROLLBACK:
--   alter table public.assigned_tasks drop column if exists department_group_id;
-- =============================================================================

alter table public.assigned_tasks
  add column if not exists department_group_id uuid
    references public.groups(id) on delete restrict;

create index if not exists assigned_tasks_department_group_id
  on public.assigned_tasks (department_group_id)
  where department_group_id is not null;

-- Backfill: any existing row gets the Web Dev group as a sane default.
-- Safe under no rows too — the update is a no-op.
update public.assigned_tasks t
   set department_group_id = g.id
  from public.groups g
 where g.code = 'web_dev'
   and t.department_group_id is null;

alter table public.assigned_tasks
  alter column department_group_id set not null;
