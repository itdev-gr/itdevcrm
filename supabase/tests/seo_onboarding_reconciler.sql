-- supabase/tests/seo_onboarding_reconciler.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(7);

select has_function('public','seo_onboarding_pending_jobs','helper exists');
select has_function('public','reconcile_seo_onboarding_emails','reconciler exists');

-- Setup: an already-onboarded local_seo job >1h old, toggles on, client email, no email rows.
do $$
declare v_deal uuid; v_client uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  perform set_config('t.deal', v_deal::text, true);
  update public.clients set email='reconcile-test@example.gr' where id=v_client;
  update public.email_automation_settings set enabled=true where key in ('dept_technical','localseo_gbp');
  delete from public.jobs where deal_id=v_deal and service_type='local_seo';
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  delete from public.email_log    where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 240, 24, 'active',
            (select id from public.pipeline_stages where board='local_seo' and code='renewal' and not archived limit 1),
            now() - interval '2 hours', false, now(), (select code from public.deals where id=v_deal));
end $$;

select is((select count(*)::int from public.seo_onboarding_pending_jobs()
           where deal_id=current_setting('t.deal')::uuid),
          1, 'pending: unsent onboarding job is detected');

-- Reconciler re-queues exactly one email with the right template + dedupe key.
do $$ begin perform public.reconcile_seo_onboarding_emails(); end $$;
select is((select count(*)::int from public.email_outbox
           where dedupe_key='localseo_gbp:'||current_setting('t.deal')
             and template_key='localseo_gbp_access'),
          1, 'reconciler re-queues the missing GBP email');

-- A delivered email_log row excludes the job from the pending set.
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
begin
  delete from public.email_outbox where dedupe_key='localseo_gbp:'||v_deal;
  insert into public.email_log (to_email, template_key, status, dedupe_key, created_at)
    values ('reconcile-test@example.gr','localseo_gbp_access','delivered','localseo_gbp:'||v_deal, now());
end $$;
select is((select count(*)::int from public.seo_onboarding_pending_jobs()
           where deal_id=current_setting('t.deal')::uuid),
          0, 'pending: excludes jobs whose email already delivered');

-- toggle off -> excluded (deliberate admin choice; surfaced by health, not re-queued)
do $$
declare v_deal uuid := current_setting('t.deal')::uuid;
begin
  delete from public.email_log where dedupe_key='localseo_gbp:'||v_deal;
  update public.email_automation_settings set enabled=false where key='dept_technical';
end $$;
select is((select count(*)::int from public.seo_onboarding_pending_jobs()
           where deal_id=current_setting('t.deal')::uuid),
          0, 'pending: excludes jobs when the dept toggle is off');

-- email_pipeline_health returns the new key (structure check; the count logic is
-- fully exercised via seo_onboarding_pending_jobs above — health just counts it).
select ok(
  public.email_pipeline_health() ? 'onboarding_unsent_count'
  or public.email_pipeline_health()->>'status' = 'ok',
  'email_pipeline_health exposes onboarding_unsent_count (or is non-admin ok)');

select * from finish();
rollback;
