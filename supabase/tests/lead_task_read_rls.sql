-- supabase/tests/lead_task_read_rls.sql
-- Run with: supabase test db   (transactional; rolls back)
--
-- RLS regression for lead task read visibility (spec 2026-07-28):
--   (a) the lead's OWNER (non-party, non-admin) READS the task, its thread,
--       and in-thread files — but CANNOT post (42501);
--   (b) another rep (not the lead owner) sees ZERO rows for all three;
--   (c) a task party still reads AND posts (unchanged).
begin;
select plan(10);

select has_function('public', 'can_read_task', array['uuid','uuid'], 'helper exists');

-- Fixture as superuser: a lead owned by a NON-admin rep; a task on it whose
-- assignee+creator are BOTH someone else; one thread message with one file.
do $$
declare
  v_lead uuid; v_owner uuid; v_outsider uuid;
  v_parties uuid[]; v_assignee uuid; v_creator uuid;
  v_task uuid; v_comment uuid;
begin
  select l.id, l.owner_user_id into v_lead, v_owner
    from public.leads l
    join public.profiles p on p.user_id = l.owner_user_id
   where coalesce(p.is_admin, false) = false
   limit 1;

  select array_agg(user_id) into v_parties from (
    select user_id from public.profiles where user_id <> v_owner limit 2) s;
  v_assignee := v_parties[1];
  v_creator  := v_parties[2];

  select user_id into v_outsider from public.profiles
   where coalesce(is_admin, false) = false
     and user_id not in (v_owner, v_assignee, v_creator)
   limit 1;

  insert into public.user_tasks (user_id, created_by, title, due_at, lead_id)
    values (v_assignee, v_creator, 'pgTAP lead task', now(), v_lead)
    returning id into v_task;

  insert into public.task_comments (user_task_id, author_user_id, body)
    values (v_task, v_creator, 'pgTAP thread message')
    returning id into v_comment;

  insert into public.comment_attachments (task_comment_id, storage_path, file_name, uploaded_by)
    values (v_comment, 'comment/t/pgtap-lead.png', 'pgtap-lead.png', v_creator);

  perform set_config('t.owner',    v_owner::text,    true);
  perform set_config('t.outsider', v_outsider::text, true);
  perform set_config('t.assignee', v_assignee::text, true);
  perform set_config('t.task',     v_task::text,     true);
  perform set_config('t.comment',  v_comment::text,  true);
end $$;

-- ---- (a) Lead OWNER (non-party): reads everything, writes nothing. ----
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.user_tasks
            where id = current_setting('t.task')::uuid),
  1, 'lead owner SEES the non-party task on their lead');
select is((select count(*)::int from public.task_comments
            where user_task_id = current_setting('t.task')::uuid),
  1, 'lead owner READS the thread');
select is((select count(*)::int from public.comment_attachments
            where task_comment_id = current_setting('t.comment')::uuid),
  1, 'lead owner SEES the in-thread file');
select throws_ok(
  format($f$ insert into public.task_comments (user_task_id, author_user_id, body)
             values (%L, %L, 'should fail') $f$,
         current_setting('t.task'), current_setting('t.owner')),
  '42501', null, 'lead owner CANNOT post into the thread (read-only)');

-- ---- (b) Another rep (NOT the lead owner): zero rows everywhere. ----
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.outsider'), 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.user_tasks
            where id = current_setting('t.task')::uuid),
  0, 'other rep sees ZERO tasks on someone else''s lead');
select is((select count(*)::int from public.task_comments
            where user_task_id = current_setting('t.task')::uuid),
  0, 'other rep reads ZERO thread messages');
select is((select count(*)::int from public.comment_attachments
            where task_comment_id = current_setting('t.comment')::uuid),
  0, 'other rep sees ZERO in-thread files');

-- ---- (c) A PARTY (assignee): unchanged — reads and posts. ----
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.assignee'), 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.task_comments
            where user_task_id = current_setting('t.task')::uuid),
  1, 'party still reads the thread');
select lives_ok(
  format($f$ insert into public.task_comments (user_task_id, author_user_id, body)
             values (%L, %L, 'party reply') $f$,
         current_setting('t.task'), current_setting('t.assignee')),
  'party still posts into the thread');

select * from finish();
rollback;
