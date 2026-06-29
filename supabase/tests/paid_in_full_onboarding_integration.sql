-- supabase/tests/paid_in_full_onboarding_integration.sql
-- Run with: supabase test db  (transactional; rolls back)
-- Proves the wiring: setting a deal's accounting stage to paid_in_full fires
-- deals_hold_jobs_on_stage_change -> release_deal_jobs, onboarding the SEO job.
begin;
select plan(2);

do $$
declare v_deal uuid; v_client uuid; v_paid uuid; v_other uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  perform set_config('t.deal', v_deal::text, true);
  update public.clients set email='integration-test@example.gr' where id=v_client;
  update public.email_automation_settings set enabled=true where key in ('dept_technical','localseo_gbp');

  select id into v_paid from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full' limit 1;
  select id into v_other from public.pipeline_stages
    where board='accounting_onboarding' and code='invoice_issued' limit 1;

  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  delete from public.email_log    where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));

  -- Move OFF paid first (so the next move is a real transition INTO paid_in_full).
  update public.deals set accounting_stage_id = v_other where id = v_deal;
  update public.deals set accounting_stage_id = v_paid  where id = v_deal;   -- fires the trigger
end $$;

select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'new_project', 'first paid_in_full transition onboards the SEO job to New project');
select is((select count(*)::int from public.email_outbox where dedupe_key='localseo_gbp:'||current_setting('t.deal')),
          1, 'first paid_in_full transition queues the onboarding email');

select * from finish();
rollback;
