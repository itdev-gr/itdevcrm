-- 20260629100000_recurring_seo_first_paid_onboarding.sql
-- Spec: docs/superpowers/specs/2026-06-29-recurring-seo-first-paid-onboarding-design.md
-- Plan: docs/superpowers/plans/2026-06-29-recurring-seo-first-paid-onboarding.md
--
-- First Fully-Paid -> New project (+onboarding email) for recurring local_seo/web_seo;
-- later Fully-Paid -> Renewal. Once-only `onboarded_at` marker + email safety net
-- (admin-banner detection + self-heal reconciler cron).

-- 1. Marker column ------------------------------------------------------------
alter table public.jobs add column if not exists onboarded_at timestamptz;
comment on column public.jobs.onboarded_at is
  'Set the first time a recurring local_seo/web_seo job is onboarded (placed in New project at first Fully-Paid). Null = never onboarded. Drives first-time vs renewal routing in release_deal_jobs().';

-- 2. Conservative backfill (+ backup) -----------------------------------------
--    Every EXISTING SEO job is treated as already-onboarded so no current client
--    gets a surprise onboarding email on their next payment. Only brand-new jobs
--    created after this migration get the first-time flow.
create table if not exists public.jobs_onboarded_backfill_backup_20260629 as
  select id as job_id, onboarded_at as prev_onboarded_at, now() as backed_up_at
    from public.jobs
   where service_type in ('web_seo','local_seo') and not archived and onboarded_at is null;

update public.jobs
   set onboarded_at = coalesce(started_at, created_at, now())
 where service_type in ('web_seo','local_seo') and not archived and onboarded_at is null;

-- 3. release_deal_jobs: first-time onboarding (New project + email) vs renewal -
--    Fired by deals_hold_jobs_on_stage_change when a deal enters paid_in_full
--    (covers complete_accounting, accounting_mark_paid_in_full, the on-hold->paid
--    payment trigger, the overdue sweep, and manual drag).
--    RECURRING == billing_type is distinct from 'one_time' (defensive: null/odd -> recurring).
create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Fail loud (never silent): SEO boards must have their New project stage.
  if not exists (select 1 from public.pipeline_stages where board='local_seo' and code='new_project' and not archived)
     or not exists (select 1 from public.pipeline_stages where board='web_seo' and code='new_project' and not archived) then
    raise warning 'release_deal_jobs: a SEO board is missing its new_project stage; onboarding placement skipped for deal %', p_deal_id;
  end if;

  -- IMPORTANT ORDERING: the renewal move (1c) runs FIRST, before the onboarding
  -- branches (1a/1b). 1a/1b set onboarded_at=now() in this call; if 1c ran after
  -- them it would immediately match those just-onboarded rows (onboarded_at not null)
  -- and bounce them out of New project into Renewal in the same call. Running 1c first
  -- means it only ever sees rows onboarded in a PRIOR call.

  -- (1c) recurring SEO, already onboarded (in a prior call) -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is not null
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (1a) recurring SEO, never onboarded, off-board -> New project + mark + unblock.
  --      null->new_project fires jobs_seo_onboarding_email. Fixes the direct-drag gap.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now(),
         stage_id=(select s.id from public.pipeline_stages s
                    where s.board=j.service_type and s.code='new_project' and not s.archived limit 1)
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is null and j.stage_id is null
     and exists (select 1 from public.pipeline_stages s
                  where s.board=j.service_type and s.code='new_project' and not s.archived);

  -- (1b) recurring SEO, never onboarded, already on a board -> mark + unblock; leave in place.
  --      (Placed earlier by complete_accounting / partial / ai_seo child; email already fired.)
  --      Kills the bounce-to-Renewal on first paid.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now()
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is null and j.stage_id is not null;

  -- (2) UNCHANGED renewal-move: one-time SEO + all ads/social_media -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and ( (j.service_type in ('web_seo','local_seo') and j.billing_type='one_time')
           or j.service_type in ('ads','social_media') )
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (3) UNCHANGED: everything else (web_dev, hosting, ai_seo parent) -> unblock only.
  update public.jobs
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
   where deal_id=p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending')
     and service_type not in ('web_seo','local_seo','ads','social_media');
end $$;

-- 4. Shared helper: recurring SEO jobs whose onboarding email has NOT landed ---
--    Used by both email_pipeline_health (count) and the reconciler (re-queue).
--    SECURITY DEFINER, not granted to public (exposes client emails); the two
--    definer callers reach it as owner.
create or replace function public.seo_onboarding_pending_jobs()
returns table (job_id uuid, deal_id uuid, service_type text, to_email text,
               setting_key text, template_key text, dedupe_key text, code text)
language sql stable security definer set search_path = public as $$
  select j.id, j.deal_id, j.service_type, c.email,
         m.setting_key, m.template_key, (m.setting_key || ':' || j.deal_id::text), j.code
    from public.jobs j
    join public.clients c on c.id = j.client_id
    join (values ('local_seo','localseo_gbp','localseo_gbp_access'),
                 ('web_seo','webseo_gsc','webseo_gsc_access')) as m(service_type, setting_key, template_key)
      on m.service_type = j.service_type
   where not j.archived
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is not null
     and j.onboarded_at < now() - interval '1 hour'
     and coalesce(trim(c.email),'') <> ''
     and public.email_automation_enabled(m.setting_key)
     and not exists (select 1 from public.email_log el
                      where el.dedupe_key = m.setting_key || ':' || j.deal_id::text
                        and el.status in ('sent','delivered','bounced','complained'))
     and not exists (select 1 from public.email_outbox eo
                      where eo.dedupe_key = m.setting_key || ':' || j.deal_id::text
                        and eo.status in ('pending','sending'));
$$;
revoke all on function public.seo_onboarding_pending_jobs() from public;

-- 5. Self-heal reconciler + 15-min cron ---------------------------------------
--    Idempotent: dedupe key + the email_log dedupe-unique index prevent duplicates;
--    pending rows are skipped (the drain owns those, already flagged by health).
create or replace function public.reconcile_seo_onboarding_emails()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from public.seo_onboarding_pending_jobs() loop
    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
      values ('accounting', r.to_email, r.template_key,
              jsonb_build_object('code', coalesce(r.code,'')), r.dedupe_key);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.reconcile_seo_onboarding_emails() from public;

do $$ begin perform cron.unschedule('reconcile_seo_onboarding_emails'); exception when others then null; end $$;
select cron.schedule('reconcile_seo_onboarding_emails', '*/15 * * * *',
  $$ select public.reconcile_seo_onboarding_emails(); $$);

-- 6. email_pipeline_health(): also report onboarding emails that never landed --
create or replace function public.email_pipeline_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  last_run_age int; stuck int; maxed int; failed_recent int; oldest_pending int;
  onboarding_unsent int; v_status text; v_reason text;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('status', 'ok');
  end if;

  select extract(epoch from now() - last_run_at)::int into last_run_age
    from public.email_drain_heartbeat where id;
  select count(*) into stuck from public.email_outbox
    where status='pending' and created_at < now() - interval '15 minutes';
  select count(*) into maxed from public.email_outbox
    where status='pending' and attempts >= 5;
  select count(*) into failed_recent from public.email_log
    where status='failed' and created_at > now() - interval '1 hour';
  select extract(epoch from now() - min(created_at))::int into oldest_pending
    from public.email_outbox where status='pending';
  select count(*) into onboarding_unsent from public.seo_onboarding_pending_jobs();

  if last_run_age is null or last_run_age > 600 then
    v_status := 'down';
  elsif coalesce(stuck,0) > 0 or coalesce(maxed,0) > 0 or coalesce(failed_recent,0) > 0
        or coalesce(onboarding_unsent,0) > 0 then
    v_status := 'degraded';
  else
    v_status := 'ok';
  end if;

  v_reason := case
    when last_run_age is null               then 'drain has never run'
    when last_run_age > 600                 then 'drain last ran ' || last_run_age || 's ago'
    when coalesce(stuck,0) > 0              then stuck || ' email(s) stuck pending'
    when coalesce(maxed,0) > 0              then maxed || ' email(s) hit max retries'
    when coalesce(failed_recent,0) > 0      then failed_recent || ' send failure(s) in the last hour'
    when coalesce(onboarding_unsent,0) > 0  then onboarding_unsent || ' onboarding email(s) not sent'
    else 'ok' end;

  return jsonb_build_object(
    'status', v_status, 'reason', v_reason,
    'last_run_age_seconds', last_run_age,
    'stuck_count', coalesce(stuck,0),
    'failed_count', coalesce(failed_recent,0),
    'onboarding_unsent_count', coalesce(onboarding_unsent,0),
    'oldest_pending_age_seconds', oldest_pending);
end $$;
revoke all on function public.email_pipeline_health() from public;
grant execute on function public.email_pipeline_health() to authenticated;

-- ROLLBACK --------------------------------------------------------------------
-- select cron.unschedule('reconcile_seo_onboarding_emails');
-- drop function if exists public.reconcile_seo_onboarding_emails();
-- drop function if exists public.seo_onboarding_pending_jobs();
-- restore public.release_deal_jobs from 20260628040000_release_deal_jobs_partial_payment.sql;
-- restore public.email_pipeline_health from 20260615000003_email_health.sql;
-- (optional) alter table public.jobs drop column onboarded_at;
--   backup of prior values: public.jobs_onboarded_backfill_backup_20260629
