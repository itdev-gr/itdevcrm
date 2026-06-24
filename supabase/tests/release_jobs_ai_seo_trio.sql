-- supabase/tests/release_jobs_ai_seo_trio.sql
begin;
select plan(3);
do $$
declare v_deal uuid; v_client uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  update public.deals set services_planned =
    jsonb_build_array(jsonb_build_object('service_type','ai_seo','billing_type','recurring_monthly','monthly_amount','250'))
    where id = v_deal;
  delete from public.jobs where deal_id = v_deal and service_type in ('ai_seo','web_seo','local_seo');
  perform public.release_jobs_for_deal(v_deal, false);
  perform set_config('t.deal', v_deal::text, true);
end $$;
select is((select count(*)::int from public.jobs
  where deal_id = current_setting('t.deal')::uuid and service_type='ai_seo' and billing_only),
  1, 'one ai_seo billing record');
select is((select amount_net from public.jobs
  where deal_id = current_setting('t.deal')::uuid and service_type='ai_seo' and billing_only),
  250::numeric, 'billing record holds the planned amount');
select is((select count(*)::int from public.jobs j
  where j.parent_job_id in (select id from public.jobs where deal_id = current_setting('t.deal')::uuid
    and service_type='ai_seo' and billing_only)),
  2, 'two children linked to it');
select * from finish();
rollback;
