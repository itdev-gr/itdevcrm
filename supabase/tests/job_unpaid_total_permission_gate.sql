-- supabase/tests/job_unpaid_total_permission_gate.sql
-- Run with: supabase test db  (transactional; rolls back)
--
-- Final-review I6: job_unpaid_total is SECURITY DEFINER (bypasses
-- deal_payments RLS) and was granted to `authenticated` with NO permission
-- check at all — any technical user could call it from the browser console
-- and read any client's exact outstanding balance. Gated with the same
-- predicate end_and_archive_job itself uses; a caller who fails it gets 0
-- (not an error — the dialog just shows no warning), and admin/accounting
-- callers still get the real total.
begin;
select plan(2);

do $$
declare v_admin uuid; v_deal uuid; v_client uuid; v_job uuid;
begin
  select user_id into v_admin from public.profiles
   where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select d.id, d.client_id into v_deal, v_client
    from public.deals d
   where d.code is not null and not d.archived and d.client_id is not null
     and not exists (select 1 from public.jobs j
                      where j.deal_id = d.id and j.service_type = 'local_seo')
   limit 1;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, onboarded_at, archived, started_at, code, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 250, 24,
            'active', now() - interval '10 days', false, now(),
            (select code from public.deals where id = v_deal)||'-UNPAIDTEST', true)
    returning id into v_job;

  insert into public.deal_payments (deal_id, service_type, billing_type, amount_net, vat_rate,
                                    status, start_date, end_date)
    values (v_deal, 'local_seo', 'recurring_monthly', 250, 24,
            'pending', current_date, current_date + 30);

  perform set_config('t.job', v_job::text, true);
end $$;

-- Admin: sees the real (non-zero) outstanding total.
select is((public.job_unpaid_total(current_setting('t.job')::uuid))::text, '310.00',
          'admin caller gets the real unpaid total (250 net + 24% VAT)');

-- A caller with no profile row at all (not admin, no group membership, no
-- per-user override) — the exact shape of a technical user probing the RPC
-- from the console for a job they cannot otherwise price.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000000042', 'role', 'authenticated')::text, true);
end $$;

select is((public.job_unpaid_total(current_setting('t.job')::uuid))::text, '0',
          'a caller who is neither admin nor accounting_onboarding-edit gets 0, not the real total');

select * from finish();
rollback;
