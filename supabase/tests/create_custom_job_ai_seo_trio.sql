-- supabase/tests/create_custom_job_ai_seo_trio.sql
begin;
select plan(6);
-- become an admin so the RPC permission gate passes
do $$
declare v_admin uuid; v_deal uuid; r jsonb;
begin
  select user_id into v_admin from public.profiles where is_admin limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform set_config('role', 'authenticated', true);
  select id into v_deal from public.deals where code is not null limit 1;
  select public.create_custom_job(v_deal, 'AI SEO', null, 'ai_seo', 'recurring_monthly', 300, 24, 0, false, 'none')
    into r;
  perform set_config('t.parent', (r->>'job_id'), true);
end $$;
select is((select service_type from public.jobs where id = current_setting('t.parent')::uuid),
  'ai_seo', 'parent is ai_seo');
select is((select billing_only from public.jobs where id = current_setting('t.parent')::uuid),
  true, 'parent is billing_only');
select is((select amount_net from public.jobs where id = current_setting('t.parent')::uuid),
  300::numeric, 'parent holds the price');
select is(
  (select count(*)::int from public.jobs where parent_job_id = current_setting('t.parent')::uuid),
  2, 'two children created');
select is(
  (select owner_user_id from public.jobs where parent_job_id = current_setting('t.parent')::uuid and service_type='web_seo'),
  '19aa9170-bd62-4319-8118-668c11e93c98'::uuid, 'web child owned by pefstathiadis');
select is(
  (select owner_user_id from public.jobs where parent_job_id = current_setting('t.parent')::uuid and service_type='local_seo'),
  'b73d8761-cbae-4ac8-a239-878d1f2151d8'::uuid, 'local child owned by dtzouvaras');
select * from finish();
rollback;
