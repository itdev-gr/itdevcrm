-- supabase/tests/comment_attachments_rls.sql
-- Run with: supabase test db   (transactional; rolls back)
--
-- RLS regression for public.comment_attachments — the privacy invariant:
--   (a) a task party can INSERT + SELECT a file on their task comment;
--   (b) a NON-party sees 0 rows and gets 42501 inserting a task-comment file;
--   (c) any authenticated staffer SELECTs a general-comment file;
--   (d) a non-owner non-admin DELETE of another's file removes 0 rows (the RLS
--       USING clause filters it silently — a filtered DELETE affects 0 rows,
--       it does not raise 42501).
-- Behaviour independently proven against prod via the Management-API harness on
-- 2026-07-23 (gen_visible_nonparty=1, task_visible_nonparty=0, task_visible_party=1).
begin;
select plan(7);

select has_table('public', 'comment_attachments', 'table exists');

-- Fixture built as the superuser role (before switching to authenticated).
-- Reuse an EXISTING assigned_task + its real parties (mirrors the prod harness),
-- so we don't depend on assigned_tasks' full NOT NULL set.
do $$
declare
  v_deal     uuid;
  v_party    uuid;  -- assignee of the task (a party)
  v_creator  uuid;  -- creator of the task (also a party)
  v_outsider uuid;  -- neither, and non-admin -> non-party
  v_task     uuid;
  v_gcomment uuid;
  v_tcomment uuid;
begin
  select id into v_deal from public.deals limit 1;
  select id, assignee_user_id, created_by_user_id
    into v_task, v_party, v_creator
    from public.assigned_tasks
   where assignee_user_id is not null and created_by_user_id is not null
   limit 1;
  select user_id into v_outsider from public.profiles
   where coalesce(is_admin, false) = false
     and user_id <> v_party and user_id <> v_creator
   limit 1;

  -- comments uses author_id (NOT author_user_id); task_comments uses author_user_id.
  insert into public.comments (parent_type, parent_id, body, author_id)
    values ('deal', v_deal, 'pgTAP general comment', v_creator)
    returning id into v_gcomment;
  insert into public.task_comments (assigned_task_id, author_user_id, body)
    values (v_task, v_party, 'pgTAP task comment')
    returning id into v_tcomment;

  perform set_config('t.party',    v_party::text,    true);
  perform set_config('t.outsider', v_outsider::text, true);
  perform set_config('t.gcomment', v_gcomment::text, true);
  perform set_config('t.tcomment', v_tcomment::text, true);
end $$;

-- ---- (a) A task party can INSERT + SELECT a file on their task comment. ----
set local role authenticated;
set local "request.jwt.claims" to
  (select json_build_object('sub', current_setting('t.party'), 'role', 'authenticated')::text);

select lives_ok(
  format($f$ insert into public.comment_attachments (task_comment_id, storage_path, file_name, uploaded_by)
             values (%L, 'comment/t/task.png', 'task.png', %L) $f$,
         current_setting('t.tcomment'), current_setting('t.party')),
  'party can insert a file on their task comment');

select is(
  (select count(*)::int from public.comment_attachments
     where task_comment_id = current_setting('t.tcomment')::uuid),
  1, 'party SEES the task-comment file');

select lives_ok(
  format($f$ insert into public.comment_attachments (comment_id, storage_path, file_name, uploaded_by)
             values (%L, 'comment/g/gen.png', 'gen.png', %L) $f$,
         current_setting('t.gcomment'), current_setting('t.party')),
  'staffer can insert a file on a general comment');

-- ---- (b) A NON-party is denied: 0 rows on select, 42501 on insert. ----
reset role;
set local role authenticated;
set local "request.jwt.claims" to
  (select json_build_object('sub', current_setting('t.outsider'), 'role', 'authenticated')::text);

select is(
  (select count(*)::int from public.comment_attachments
     where task_comment_id = current_setting('t.tcomment')::uuid),
  0, 'NON-party sees ZERO task-comment files (RLS hides the private task file)');

select throws_ok(
  format($f$ insert into public.comment_attachments (task_comment_id, storage_path, file_name, uploaded_by)
             values (%L, 'comment/t/leak.png', 'leak.png', %L) $f$,
         current_setting('t.tcomment'), current_setting('t.outsider')),
  '42501', null,
  'NON-party cannot insert a file on a task comment they are not party to');

-- ---- (c) Any authenticated staffer SELECTs the general-comment file. ----
select is(
  (select count(*)::int from public.comment_attachments
     where comment_id = current_setting('t.gcomment')::uuid),
  1, 'any staffer SEES a general-comment file');

-- ---- (d) A non-owner non-admin DELETE removes 0 rows (USING filters it). ----
select is(
  (with del as (
     delete from public.comment_attachments
      where comment_id = current_setting('t.gcomment')::uuid
      returning 1)
   select count(*)::int from del),
  0, 'non-owner non-admin DELETE of another''s file affects 0 rows');

select * from finish();
rollback;
