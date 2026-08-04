-- supabase/tests/job_billing_pause_contract.sql
-- Run with: supabase test db  (transactional; rolls back)
--
-- Guards the contract between job_pause_billing / job_resume_billing and
-- src/features/jobs/hooks/useJobBillingPause.ts, which does:
--   if (!result.ok) throw new Error((result.errors ?? ['unknown_error']).join(', '));
-- Before 20260806090000 neither RPC returned `ok`, so every SUCCESS surfaced in
-- the UI as `unknown_error` while the database had already paused the chain.
begin;
select plan(6);

-- The RPCs are permission-gated on auth.uid(); adopt an admin identity the way
-- supabase/tests/create_custom_job_ai_seo_trio.sql does.
do $$
declare v_admin uuid;
begin
  select user_id into v_admin from public.profiles
   where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
end $$;

do $$
declare v_deal uuid; v_client uuid; v_job uuid; v_stage uuid;
begin
  -- A deal with no local_seo job, so nothing has to be deleted (jobs are
  -- referenced by email_messages and cannot be removed).
  select d.id, d.client_id into v_deal, v_client
    from public.deals d
   where d.code is not null and not d.archived and d.client_id is not null
     and not exists (select 1 from public.jobs j
                      where j.deal_id = d.id and j.service_type = 'local_seo')
   limit 1;

  select id into v_stage from public.pipeline_stages
   where board = 'local_seo' and code = 'done' and not archived limit 1;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 250, 24,
            'active', v_stage, now() - interval '40 days', false, now(),
            (select code from public.deals where id = v_deal)||'-PAUSETEST', true)
    returning id into v_job;

  -- An unpaid recurring row for the pause to excuse.
  insert into public.deal_payments (deal_id, service_type, billing_type, amount_net, vat_rate,
                                    status, start_date, end_date)
    values (v_deal, 'local_seo', 'recurring_monthly', 250, 24,
            'pending', current_date, current_date + 30);

  perform set_config('t.job', v_job::text, true);
  perform set_config('t.pause', public.job_pause_billing(v_job)::text, true);
end $$;

select is((current_setting('t.pause')::jsonb ->> 'ok'), 'true',
          'pause reports ok, so the hook does not throw on success');
select is((current_setting('t.pause')::jsonb ->> 'payments_cancelled'), '1',
          'pause still reports how many rows it excused');
select is((select billing_active::text from public.jobs where id = current_setting('t.job')::uuid),
          'false', 'pause really did stop the billing');

do $$
begin
  perform set_config('t.resume', public.job_resume_billing(current_setting('t.job')::uuid)::text, true);
end $$;

select is((current_setting('t.resume')::jsonb ->> 'ok'), 'true',
          'resume reports ok, so the hook does not throw on success');
select isnt((current_setting('t.resume')::jsonb ->> 'new_payment_id'), null,
            'resume still reports the period it opened');
select is((select billing_active::text from public.jobs where id = current_setting('t.job')::uuid),
          'true', 'resume really did restart the billing');

select * from finish();
rollback;
