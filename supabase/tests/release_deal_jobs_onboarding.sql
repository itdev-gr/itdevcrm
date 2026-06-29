-- supabase/tests/release_deal_jobs_onboarding.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(14);

-- Shared target deal/client + automation toggles on + client has an email.
do $$
declare v_deal uuid; v_client uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  perform set_config('t.deal', v_deal::text, true);
  perform set_config('t.client', v_client::text, true);
  update public.clients set email = 'onboard-test@example.gr' where id = v_client;
  update public.email_automation_settings set enabled = true
    where key in ('dept_technical','localseo_gbp','webseo_gsc');
end $$;

select has_column('public','jobs','onboarded_at','jobs.onboarded_at exists');
select has_table('public','jobs_onboarded_backfill_backup_20260629','backfill backup table exists');

-- 1a. off-board recurring local_seo -> New project + marker + email
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
        v_client uuid := current_setting('t.client')::uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type in ('local_seo','web_seo');
  delete from public.email_outbox where dedupe_key in ('localseo_gbp:'||v_deal,'webseo_gsc:'||v_deal);
  delete from public.email_log    where dedupe_key in ('localseo_gbp:'||v_deal,'webseo_gsc:'||v_deal);
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;

select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'new_project', '1a: off-board local_seo -> New project');
select isnt((select onboarded_at from public.jobs
             where deal_id=current_setting('t.deal')::uuid and service_type='local_seo'),
            null, '1a: onboarded_at set');
select is((select count(*)::int from public.email_outbox
           where dedupe_key='localseo_gbp:'||current_setting('t.deal')),
          1, '1a: GBP onboarding email queued');

-- 1c. already-onboarded local_seo, second paid -> Renewal
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
begin
  perform public.release_deal_jobs(v_deal);  -- second call; job now has onboarded_at
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'renewal', '1c: second paid -> Renewal');
select is((select count(*)::int from public.email_outbox
           where dedupe_key='localseo_gbp:'||current_setting('t.deal')),
          1, '1c: no duplicate email on second paid');

-- 1b. not-onboarded but already on a board (new_project) -> mark + stay (no bounce)
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid; v_np uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  select id into v_np from public.pipeline_stages where board='local_seo' and code='new_project' and not archived limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24,
            'active', v_np, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'new_project', '1b: stays in New project (no bounce)');
select isnt((select onboarded_at from public.jobs
             where deal_id=current_setting('t.deal')::uuid and service_type='local_seo'),
            null, '1b: marked onboarded');

-- 2. one-time local_seo -> Renewal (unchanged), not New project
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid; v_np uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  select id into v_np from public.pipeline_stages where board='local_seo' and code='new_project' and not archived limit 1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'one_time', 240, 24,
            'active', v_np, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'renewal', '2: one-time local_seo -> Renewal (unchanged)');

-- recurring_yearly (non-one_time) treated as recurring -> onboards (defensive predicate)
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_yearly', 240, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='local_seo'),
          'new_project', 'recurring_yearly treated as recurring -> New project');

-- idempotency: re-running 1a scenario twice queues exactly one email and stays put
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  delete from public.email_log    where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select count(*)::int from public.email_outbox where dedupe_key='localseo_gbp:'||current_setting('t.deal')),
          1, 'idempotency: one email after two calls');

-- web_seo analog of 1a (GSC)
do $$
declare v_deal uuid := current_setting('t.deal')::uuid; v_client uuid := current_setting('t.client')::uuid;
begin
  delete from public.jobs where deal_id=v_deal and service_type='web_seo';
  delete from public.email_outbox where dedupe_key='webseo_gsc:'||v_deal;
  delete from public.email_log    where dedupe_key='webseo_gsc:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 300, 24,
            'active', null, null, false, now(), (select code from public.deals where id=v_deal));
  perform public.release_deal_jobs(v_deal);
end $$;
select is((select ps.code from public.jobs j join public.pipeline_stages ps on ps.id=j.stage_id
           where j.deal_id=current_setting('t.deal')::uuid and j.service_type='web_seo'),
          'new_project', 'web_seo: off-board -> New project');
select is((select count(*)::int from public.email_outbox where dedupe_key='webseo_gsc:'||current_setting('t.deal')),
          1, 'web_seo: GSC onboarding email queued');

select * from finish();
rollback;
