-- =============================================================================
-- One-time Local/Web SEO onboarding parity (owner decision 2026-07-16).
--
-- Since 20260629100000, ONE-TIME local_seo/web_seo jobs landed in Renewal on
-- first Fully Paid (branch 2) and never fired the GBP/GSC access email — a
-- deliberately deferred product decision. Real one-time deals arrived
-- (005906/005877/005977/005984-LOCALSEO, 07-13..07-16): the release path placed
-- them at new_project then bounced them to renewal in the same transaction, and
-- the Local SEO team kept dragging them back by hand. Owner decided: one-time
-- SEO onboards EXACTLY like recurring — first Fully Paid -> New project + GBP/GSC
-- email; later cycles -> Renewal.
--
-- Changes:
--   1) release_deal_jobs: drop the `billing_type is distinct from 'one_time'`
--      filters from branches 1c/1a/1b; branch 2 keeps only ads/social_media.
--   2) seo_onboarding_pending_jobs (email safety net): drop its one_time filter
--      so the reconciler also covers one-time onboardings. Blast radius asserted
--      zero below (no pre-existing one-time job has onboarded_at >= cutover).
--
-- jobs_seo_onboarding_email needs NO change (it never filtered billing_type;
-- pay gate + dedupe + dept toggle unchanged). jobs_protect_onboarded_seo_stage
-- now also guards onboarded one-time jobs — correct and intended.
--
-- Verified via rolled-back RED/GREEN DO-blocks on prod before applying:
--   RED  (old fn): one_time local_seo after release -> renewal.
--   GREEN (new fn): -> new_project; same-cycle re-entry stays; onboarded_at
--   stamped; GBP email queued (outbox=1). Zero footprint (raise-exception rollback).
--
-- Live bodies of both functions were read via pg_get_functiondef immediately
-- before authoring this file (no drift vs repo).
--
-- ROLLBACK (manual): restore release_deal_jobs from
-- 20260706120000_release_deal_jobs_cycle_aware_renewal.sql and
-- seo_onboarding_pending_jobs from 20260629110000 (as amended live — read
-- pg_get_functiondef first per standing drift rule).
-- =============================================================================

create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Fail loud (never silent): SEO boards must have their New project stage.
  if not exists (select 1 from public.pipeline_stages where board='local_seo' and code='new_project' and not archived)
     or not exists (select 1 from public.pipeline_stages where board='web_seo' and code='new_project' and not archived) then
    raise warning 'release_deal_jobs: a SEO board is missing its new_project stage; onboarding placement skipped for deal %', p_deal_id;
  end if;

  -- IMPORTANT ORDERING: the renewal move (1c) runs FIRST, before the onboarding
  -- branches (1a/1b), so it only ever sees rows onboarded in a PRIOR call.
  -- 2026-07-16: one_time SEO onboards exactly like recurring (owner decision) —
  -- the billing_type filters were removed from 1c/1a/1b; branch 2 is ads/social only.

  -- (1c) SEO onboarded in a PRIOR CYCLE -> Renewal (non-terminal) + unblock.
  --      Cycle-aware guard: only when the paid period advanced past onboarding
  --      (+14d tolerance absorbs same-cycle payment re-dating).
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is not null
     and j.period_start_date is not null
     and j.period_start_date > (j.onboarded_at + interval '14 days')::date
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (1a) SEO never onboarded, off-board -> New project + mark + unblock.
  --      null->new_project fires jobs_seo_onboarding_email.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now(),
         stage_id=(select s.id from public.pipeline_stages s
                    where s.board=j.service_type and s.code='new_project' and not s.archived limit 1)
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is null and j.stage_id is null
     and exists (select 1 from public.pipeline_stages s
                  where s.board=j.service_type and s.code='new_project' and not s.archived);

  -- (1b) SEO never onboarded, already on a board -> mark + unblock; leave in place.
  --      (Placed earlier by release_jobs_for_deal / partial / ai_seo child; email
  --      already fired on that placement.)
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now()
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is null and j.stage_id is not null;

  -- (2) ads/social_media -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('ads','social_media')
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (3) UNCHANGED: everything else (web_dev, hosting, ai_seo parent) -> unblock only.
  update public.jobs
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
   where deal_id=p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending')
     and service_type not in ('web_seo','local_seo','ads','social_media');
end $$;

-- 2) Email safety net: also cover one-time onboardings.
create or replace function public.seo_onboarding_pending_jobs()
returns table(job_id uuid, deal_id uuid, service_type text, to_email text,
              setting_key text, template_key text, dedupe_key text, code text, name text)
language sql stable security definer set search_path = public as $$
  select j.id, j.deal_id, j.service_type, c.email,
         m.setting_key, m.template_key, (m.setting_key || ':' || j.deal_id::text), j.code, c.name
    from public.jobs j
    join public.clients c on c.id = j.client_id
    join (values ('local_seo','localseo_gbp','localseo_gbp_access'),
                 ('web_seo','webseo_gsc','webseo_gsc_access')) as m(service_type, setting_key, template_key)
      on m.service_type = j.service_type
   where not j.archived
     and j.onboarded_at is not null
     and j.onboarded_at >= (select cutover_at from public.seo_onboarding_config where id)
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

-- Post-asserts — fail loudly if anything is off.
do $$
declare n int;
begin
  -- NB: match the FILTER EXPRESSIONS, not the bare string 'one_time' — prosrc
  -- includes comments (first apply attempt tripped on its own comment).
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
             where ns.nspname='public' and p.proname='release_deal_jobs'
               and (p.prosrc like $like$%distinct from 'one_time'%$like$
                    or p.prosrc like $like$%billing_type='one_time'%$like$)) then
    raise exception 'release_deal_jobs still filters on one_time';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
             where ns.nspname='public' and p.proname='seo_onboarding_pending_jobs'
               and p.prosrc like $like$%distinct from 'one_time'%$like$) then
    raise exception 'seo_onboarding_pending_jobs still filters on one_time';
  end if;
  -- Reconciler blast radius: widening to one-time must surface ZERO jobs now
  -- (no pre-existing one-time job was onboarded after the cutover).
  select count(*) into n
    from public.seo_onboarding_pending_jobs() p
    join public.jobs j on j.id = p.job_id
   where j.billing_type = 'one_time';
  if n <> 0 then
    raise exception 'reconciler would email % pre-existing one-time jobs — investigate before applying', n;
  end if;
end $$;
