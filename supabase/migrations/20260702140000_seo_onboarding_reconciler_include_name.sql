-- 2026-07-02: Fix the SEO-onboarding SAFETY-NET RECONCILER's broken greeting.
--
-- The primary onboarding path (jobs_seo_onboarding_email trigger) was fixed on
-- 2026-06-30 (20260630040000) to enqueue data = {code, name}, so the GBP/GSC
-- access emails render "Γεια σας <name>," correctly. But the */15 self-heal
-- reconciler (reconcile_seo_onboarding_emails, added 06-29 in 20260629100000)
-- was missed — it still enqueued jsonb_build_object('code', ...) with NO name,
-- so any email it re-queued rendered a broken "Γεια σας ," greeting.
--
-- Root cause: seo_onboarding_pending_jobs() (which the reconciler loops over)
-- never returned the client name, so the reconciler had nothing to pass. This
-- migration adds the `name` column to that helper (it already joins clients c)
-- and updates the reconciler to pass {code, name}, matching the trigger.
--
-- Adding a column changes the function's return type, so the helper is dropped
-- and recreated (CREATE OR REPLACE cannot alter OUT columns). The recreated
-- helper preserves the cutover predicate from 20260629110000 and re-applies the
-- hardened grants from 20260701230000 (a fresh function defaults to PUBLIC
-- EXECUTE, which must be revoked).

-- 1. Helper: add `name` (client name) to the returned set. -------------------
drop function if exists public.seo_onboarding_pending_jobs();
create function public.seo_onboarding_pending_jobs()
returns table (job_id uuid, deal_id uuid, service_type text, to_email text,
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
revoke all on function public.seo_onboarding_pending_jobs() from public, anon, authenticated;
grant execute on function public.seo_onboarding_pending_jobs() to service_role;

-- 2. Reconciler: pass {code, name}, matching jobs_seo_onboarding_email. -------
create or replace function public.reconcile_seo_onboarding_emails()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from public.seo_onboarding_pending_jobs() loop
    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
      values ('accounting', r.to_email, r.template_key,
              jsonb_build_object('code', coalesce(r.code,''), 'name', coalesce(r.name,'')),
              r.dedupe_key);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.reconcile_seo_onboarding_emails() from public, anon, authenticated;
grant execute on function public.reconcile_seo_onboarding_emails() to service_role;

-- ROLLBACK:
--   Restore the name-less versions:
--   drop function if exists public.seo_onboarding_pending_jobs();
--   -- recreate seo_onboarding_pending_jobs() exactly as in 20260629110000
--   --   (RETURNS TABLE without the `name` column; SELECT without c.name),
--   --   then revoke all from public, anon, authenticated + grant to service_role;
--   -- recreate reconcile_seo_onboarding_emails() as in 20260629100000
--   --   (jsonb_build_object('code', coalesce(r.code,'')) only).
