-- supabase/tests/assigned_tasks_department.sql
--
-- Smoke test for the assigned_tasks.department_group_id column.
-- Run with:
--   PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
--     "host=db.xujlrclyzxrvxszepquy.supabase.co port=5432 dbname=postgres user=postgres" \
--     -f supabase/tests/assigned_tasks_department.sql
--
-- The whole script runs in a transaction and rolls back; no real data is
-- modified.

begin;

-- 1. Column exists and is NOT NULL.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'assigned_tasks'
       and column_name  = 'department_group_id'
       and is_nullable  = 'NO'
  ) then
    raise exception 'department_group_id missing or still nullable';
  end if;
end $$;

-- 2. Insert without department fails with NOT NULL violation.
do $$
declare
  a_deal    uuid;
  a_user    uuid;
  a_creator uuid;
begin
  select id      into a_deal    from public.deals     limit 1;
  select user_id into a_user    from public.profiles where is_active limit 1;
  select user_id into a_creator from public.profiles where is_admin  limit 1;

  begin
    insert into public.assigned_tasks (deal_id, title, assignee_user_id, created_by_user_id)
    values (a_deal, 'no-dept', a_user, a_creator);
    raise exception 'expected insert without department_group_id to fail';
  exception when not_null_violation then
    null; -- expected
  end;
end $$;

rollback;
