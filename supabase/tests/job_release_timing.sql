-- supabase/tests/job_release_timing.sql
-- Run with: supabase test db  (transactional; rolls back)
-- Web Dev + Hosting release at Partial Payment; everything else at Fully Paid;
-- AI SEO children seeded off-board at deal creation.
begin;
select plan(6);

do $$
declare v_deal uuid; v_client uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  perform set_config('t.deal', v_deal::text, true);
end $$;

-- Scenario 1: Partial Payment releases ONLY web_dev + hosting.
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
begin
  update public.deals set services_planned = jsonb_build_array(
      jsonb_build_object('service_type','web_dev','billing_type','one_time','one_time_amount','500'),
      jsonb_build_object('service_type','hosting','billing_type','recurring_monthly','monthly_amount','20'),
      jsonb_build_object('service_type','local_seo','billing_type','recurring_monthly','monthly_amount','240'))
    where id = v_deal;
  delete from public.jobs where deal_id = v_deal and service_type in ('web_dev','hosting','local_seo');
  perform public.release_jobs_for_deal(v_deal, true);  -- partial mode
end $$;
select isnt((select stage_id from public.jobs where deal_id=current_setting('t.deal')::uuid and service_type='web_dev'),
            null, 'partial: web_dev released on-board');
select isnt((select stage_id from public.jobs where deal_id=current_setting('t.deal')::uuid and service_type='hosting'),
            null, 'partial: hosting released on-board');
select is((select count(*)::int from public.jobs where deal_id=current_setting('t.deal')::uuid and service_type='local_seo'),
          0, 'partial: local_seo NOT released');

-- Scenario 2: Fully Paid (false mode) releases the rest -> local_seo into New project.
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
begin
  perform public.release_jobs_for_deal(v_deal, false);
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'new_project', 'fully paid: local_seo released into New project');

-- Scenario 3: AI SEO children seeded OFF-BOARD at deal creation.
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
begin
  update public.deals set services_planned = jsonb_build_array(
      jsonb_build_object('service_type','ai_seo','billing_type','recurring_monthly','monthly_amount','250'))
    where id = v_deal;
  delete from public.jobs where deal_id = v_deal and service_type in ('ai_seo','web_seo','local_seo');
  perform public.release_billing_jobs_for_deal(v_deal);  -- deal-creation seeder
end $$;
select is((select stage_id from public.jobs
           where deal_id=current_setting('t.deal')::uuid and service_type='web_seo' and parent_job_id is not null),
          null, 'creation: AI SEO web child is off-board');
select is((select stage_id from public.jobs
           where deal_id=current_setting('t.deal')::uuid and service_type='local_seo' and parent_job_id is not null),
          null, 'creation: AI SEO local child is off-board');

select * from finish();
rollback;
