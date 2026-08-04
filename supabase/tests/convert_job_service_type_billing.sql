-- supabase/tests/convert_job_service_type_billing.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(4);

do $$
declare
  v_admin uuid; v_deal uuid; v_client uuid; v_job uuid; v_pay uuid; v_stage uuid;
begin
  -- become an admin so the RPC permission gate passes
  select user_id into v_admin from public.profiles where is_admin limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform set_config('role', 'authenticated', true);

  -- Pick a deal that does NOT already carry a local_seo/web_seo job, instead of
  -- blindly deleting any that do: against real data that delete fails on
  -- email_messages_job_id_fkey.
  select d.id, d.client_id into v_deal, v_client
    from public.deals d
   where d.code is not null and not d.archived and d.client_id is not null
     and not exists (select 1 from public.jobs j
                      where j.deal_id = d.id and j.service_type in ('local_seo','web_seo'))
   limit 1;

  select id into v_stage from public.pipeline_stages
   where board = 'local_seo' and code = 'done' and not archived limit 1;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 250, 24,
            'active', v_stage, now() - interval '40 days', false, now(),
            (select code from public.deals where id = v_deal)||'-CONV', true)
    returning id into v_job;

  -- The payment header carries a DIFFERENT amount from the job (199 vs 250).
  -- The pre-existing top-of-function update only re-keys a payment whose
  -- amount matches the job's (coalesce(amount_net,-1) = coalesce(j.amount_net,-1)),
  -- so a same-amount fixture would pass this test with or without the new 2b
  -- block. Mismatched amounts mean the payment can only follow the job because
  -- of the new line-linked re-key (2b, branch a).
  insert into public.deal_payments (deal_id, service_type, billing_type, amount_net, vat_rate,
                                    status, start_date, end_date)
    values (v_deal, 'local_seo', 'recurring_monthly', 199, 24,
            'paid', current_date - 30, current_date)
    returning id into v_pay;
  insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
    values (v_pay, v_job, 'Local SEO', 199, 24);

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
select is(
  (select changes->>'payments_rekeyed' from public.activity_log
    where entity_type = 'job' and entity_id = current_setting('t.job')::uuid
      and changes->>'kind' = 'service_type_converted'
    order by created_at desc limit 1),
  '1', 'the audit trail records one payment re-keyed by the 2b block');

select * from finish();
rollback;
