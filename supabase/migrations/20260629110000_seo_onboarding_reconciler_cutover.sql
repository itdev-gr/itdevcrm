-- 20260629110000_seo_onboarding_reconciler_cutover.sql
-- Hotfix for 20260629100000.
--
-- The conservative backfill in 20260629100000 marked ALL existing local_seo/web_seo
-- jobs as onboarded_at = coalesce(started_at, created_at, <apply time>). The safety-net
-- reconciler / health helper looks for "onboarded job with no onboarding email on
-- record" — which is TRUE for essentially every pre-existing client (they predate the
-- feature). Left unguarded, the 15-min reconciler would auto-email the entire existing
-- SEO book — the exact "surprise existing clients" outcome the conservative backfill was
-- meant to prevent (233 candidates at deploy time).
--
-- Fix: gate the helper to jobs onboarded AT/AFTER a cutover, stored in a 1-row config
-- table. Only genuinely-new onboardings (placed in New project by release_deal_jobs after
-- go-live, onboarded_at = now()) are eligible for the auto-retry / banner. Backfilled rows
-- (onboarded_at <= the backfill moment) are excluded forever.

create table if not exists public.seo_onboarding_config (
  id         boolean primary key default true check (id),
  cutover_at timestamptz not null
);
-- clock_timestamp() advances within the transaction, so on a fresh apply this is strictly
-- AFTER 20260629100000's backfill (whose now()-fallback rows carry that migration's
-- transaction start time). On the live prod deploy the value is corrected to the backfill
-- moment by a follow-up UPDATE (see deploy notes) so post-deploy onboardings still count.
insert into public.seo_onboarding_config (id, cutover_at)
  values (true, clock_timestamp())
  on conflict (id) do nothing;

alter table public.seo_onboarding_config enable row level security;
revoke all on table public.seo_onboarding_config from anon, authenticated;

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
     and j.onboarded_at >= (select cutover_at from public.seo_onboarding_config where id)  -- only post-go-live onboardings
     and j.onboarded_at < now() - interval '1 hour'                                        -- give the normal flow time
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

-- ROLLBACK:
--   restore seo_onboarding_pending_jobs from 20260629100000 (drop the cutover predicate);
--   drop table if exists public.seo_onboarding_config;
