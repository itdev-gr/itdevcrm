-- =============================================================================
-- Email double-send hardening (bug hunt 2026-07-16).
--
-- M8: a deal with two same-service SEO jobs (e.g. standalone web_seo + an AI-SEO
-- web child) makes seo_onboarding_pending_jobs() return TWO rows carrying the
-- SAME per-deal dedupe_key; reconcile_seo_onboarding_emails then inserts two
-- outbox rows, and two concurrent drains can each pass sendOne's TOCTOU
-- dedupe check and POST to Resend twice (the email_log unique index dedupes the
-- ROW, not the API call). Fix at the source: return at most one row per
-- dedupe_key. (No current deal trips this — preventive.)
--
-- Pairs with the edge-function change (send-email/index.ts) that broadens the
-- pre-send dedupe check from status='sent' to
-- {sent,delivered,bounced,complained} so a webhook-flipped log row still blocks
-- a crash-window re-send (H4).
--
-- ROLLBACK: restore seo_onboarding_pending_jobs from 20260716190000.
-- =============================================================================

create or replace function public.seo_onboarding_pending_jobs()
returns table(job_id uuid, deal_id uuid, service_type text, to_email text,
              setting_key text, template_key text, dedupe_key text, code text, name text)
language sql stable security definer set search_path = public as $$
  -- distinct on (dedupe_key): one email per (service, deal); a deal with two
  -- same-service jobs must not enqueue the same onboarding email twice.
  select distinct on (s.dedupe_key)
         s.job_id, s.deal_id, s.service_type, s.to_email,
         s.setting_key, s.template_key, s.dedupe_key, s.code, s.name
  from (
    select j.id as job_id, j.deal_id, j.service_type, c.email as to_email,
           m.setting_key, m.template_key, (m.setting_key || ':' || j.deal_id::text) as dedupe_key,
           j.code, c.name
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
                          and eo.status in ('pending','sending'))
  ) s
  order by s.dedupe_key, s.job_id;
$$;

-- Post-assert: the helper must not return duplicate dedupe keys.
do $$
declare n int;
begin
  select count(*) into n from (
    select dedupe_key from public.seo_onboarding_pending_jobs() group by dedupe_key having count(*) > 1
  ) d;
  if n <> 0 then raise exception 'seo_onboarding_pending_jobs returns % duplicate dedupe keys', n; end if;
end $$;