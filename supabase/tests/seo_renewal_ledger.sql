-- supabase/tests/seo_renewal_ledger.sql
-- Run with: supabase test db  (transactional; rolls back)
--
-- Covers the renewal ledger from 20260804090000. Case A is deal 005014's exact
-- shape — the late payment that the 2026-07-27 done_at guard silently skipped.
begin;
select plan(9);

select has_column('public','jobs','renewed_for_period','jobs.renewed_for_period exists');
select has_function('public','force_job_renewal', array['uuid'], 'force_job_renewal(uuid) exists');

-- Shared target deal/client.
do $$
declare v_deal uuid; v_client uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  perform set_config('t.deal', v_deal::text, true);
  perform set_config('t.client', v_client::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- A. The 005014 shape: onboarded 39d ago, team parked the card in Done
--    YESTERDAY, and the cycle that started 9d ago is paid. The old guard read
--    period_start_date (cd-9) > done_at (cd-1) = false and left it in Done.
-- ---------------------------------------------------------------------------
do $$
declare
  v_deal   uuid := current_setting('t.deal')::uuid;
  v_client uuid := current_setting('t.client')::uuid;
  v_done   uuid;
  v_job    uuid;
begin
  delete from public.jobs where deal_id = v_deal and service_type in ('local_seo','web_seo');
  select id into v_done from public.pipeline_stages
   where board='local_seo' and code='done' and not archived limit 1;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code,
                           period_start_date, period_due_date, renewed_for_period)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24,
            'active', v_done, now() - interval '39 days', false, now(),
            (select code from public.deals where id = v_deal),
            current_date - 9, current_date + 21, current_date - 39)
    returning id into v_job;

  -- Parked in Done after the paid period had already started (late payment).
  update public.jobs set done_at = now() - interval '1 day' where id = v_job;

  perform set_config('t.job', v_job::text, true);
  perform set_config('t.moved', public.seo_sync_renewal_job(v_job)::text, true);
end $$;

select is(current_setting('t.moved'), 'true', 'A: late payment moves the Done card');
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id = j.stage_id
            where j.id = current_setting('t.job')::uuid),
          'renewal', 'A: card lands in Renewal');
select is((select renewed_for_period from public.jobs where id = current_setting('t.job')::uuid),
          current_date - 9, 'A: ledger stamped with the paid period');

-- ---------------------------------------------------------------------------
-- B. Idempotent: a second call for the same cycle does nothing.
-- ---------------------------------------------------------------------------
select is(public.seo_sync_renewal_job(current_setting('t.job')::uuid), false,
          'B: same cycle does not renew twice');

-- ---------------------------------------------------------------------------
-- C. The anti-bounce the done_at guard was reaching for, now handled by the
--    ledger: the team finishes THIS cycle and parks the card in Done; a
--    Fully-Paid re-entry must not yank it back to Renewal.
-- ---------------------------------------------------------------------------
do $$
declare v_job uuid := current_setting('t.job')::uuid; v_done uuid;
begin
  select id into v_done from public.pipeline_stages
   where board='local_seo' and code='done' and not archived limit 1;
  update public.jobs set stage_id = v_done where id = v_job;   -- stamps done_at = now()
  perform set_config('t.moved_again', public.seo_sync_renewal_job(v_job)::text, true);
end $$;

select is(current_setting('t.moved_again'), 'false', 'C: re-entry does not yank a parked card');
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id = j.stage_id
            where j.id = current_setting('t.job')::uuid),
          'done', 'C: card stays in Done');

-- ---------------------------------------------------------------------------
-- D. First cycle: a job onboarded today whose paid period starts today must not
--    bounce out of its onboarding lane (the +14d floor, kept for renewed_for_period
--    IS NULL).
-- ---------------------------------------------------------------------------
do $$
declare
  v_deal   uuid := current_setting('t.deal')::uuid;
  v_client uuid := current_setting('t.client')::uuid;
  v_done   uuid;
  v_job    uuid;
begin
  select id into v_done from public.pipeline_stages
   where board='web_seo' and code='done' and not archived limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code,
                           period_start_date, period_due_date)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 240, 24,
            'active', v_done, now(), false, now(),
            (select code from public.deals where id = v_deal)||'-W',
            current_date, current_date + 30)
    returning id into v_job;
  perform set_config('t.fresh_moved', public.seo_sync_renewal_job(v_job)::text, true);
end $$;

select is(current_setting('t.fresh_moved'), 'false', 'D: first cycle does not renew');

rollback;
