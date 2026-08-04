-- supabase/tests/convert_job_service_type_billing.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(3);

do $$
declare
  v_deal uuid; v_client uuid; v_job uuid; v_pay uuid; v_stage uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  delete from public.jobs where deal_id = v_deal and service_type in ('local_seo','web_seo');
  select id into v_stage from public.pipeline_stages
   where board = 'local_seo' and code = 'done' and not archived limit 1;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 250, 24,
            'active', v_stage, now() - interval '40 days', false, now(),
            (select code from public.deals where id = v_deal)||'-CONV', true)
    returning id into v_job;

  insert into public.deal_payments (deal_id, service_type, billing_type, amount_net, vat_rate,
                                    status, start_date, end_date)
    values (v_deal, 'local_seo', 'recurring_monthly', 250, 24,
            'paid', current_date - 30, current_date)
    returning id into v_pay;
  insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
    values (v_pay, v_job, 'Local SEO', 250, 24);

  perform set_config('t.job', v_job::text, true);
  perform set_config('t.pay', v_pay::text, true);
  perform public.convert_job_service_type(v_job, 'web_seo');
end $$;

select is((select service_type from public.jobs where id = current_setting('t.job')::uuid),
          'web_seo', 'job carries the new service');
select is((select service_type from public.deal_payments where id = current_setting('t.pay')::uuid),
          'web_seo', 'the payment that billed this job follows the convert');
select isnt((select period_start_date from public.jobs where id = current_setting('t.job')::uuid),
            null, 'the converted job still resolves a billing period');

rollback;
