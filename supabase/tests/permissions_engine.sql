-- supabase/tests/permissions_engine.sql
--
-- SQL smoke tests for the Phase 2 permissions engine.
--
-- HOW TO RUN:
--   Option A (psql, recommended):
--     PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
--       "host=db.xujlrclyzxrvxszepquy.supabase.co port=5432 dbname=postgres user=postgres" \
--       -f supabase/tests/permissions_engine.sql
--
--   Option B (Supabase Dashboard):
--     Open Dashboard → SQL Editor → paste this file → Run.
--
-- The whole script runs in a transaction and rolls back; no real data is modified.

begin;

-- 1. Insert a fake auth user, profile, group, membership, and one group_permission.
with new_user as (
  insert into auth.users (id, email, instance_id)
  values (gen_random_uuid(), 'test_perm@example.com', '00000000-0000-0000-0000-000000000000')
  on conflict (id) do nothing
  returning id
),
new_profile as (
  insert into public.profiles (user_id, email, full_name, must_change_password, is_admin)
  select id, 'test_perm@example.com', 'Test Permissions', false, false from new_user
  on conflict (user_id) do nothing
  returning user_id
),
new_group as (
  insert into public.groups (code, display_names, parent_label, position)
  values ('test_group_xyz', '{"en": "Test", "el": "Test"}'::jsonb, 'Test', 999)
  on conflict (code) do nothing
  returning id
),
membership as (
  insert into public.user_groups (user_id, group_id)
  select np.user_id, ng.id from new_profile np, new_group ng
  on conflict (user_id, group_id) do nothing
  returning user_id, group_id
),
grant_view as (
  insert into public.group_permissions (group_id, board, action, scope, allowed)
  select ng.id, 'sales', 'view', 'group', true from new_group ng
  on conflict (group_id, board, action) do nothing
  returning id
)
select 'setup_inserts: ' || count(*)::text as result from grant_view;

-- 2. Simulate the test user as the auth.uid() caller
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select user_id from public.profiles where email='test_perm@example.com'))::text,
  true
);

-- 3. Verify
select 'view allowed (expect true): ' || (current_user_can('sales','view'))::text;
select 'edit denied (expect true): ' || (not current_user_can('sales','edit'))::text;
select 'scope (expect group): ' || coalesce(current_user_scope('sales','view'), 'null');

-- 4. Roll back — leaves the database untouched.
rollback;

select 'tests complete (transaction rolled back)' as result;
