-- 20260626110000_seo_access_sent_map.sql
-- Generalizes gbp_access_sent_map to cover BOTH SEO access-request emails
-- (local_seo → GBP, web_seo → GSC) for the on-card "Request access" button.
-- email_log is admin-read only, so this is security-definer + authenticated grant.
create or replace function public.seo_access_sent_map()
returns table (template_key text, to_email text, last_sent timestamptz)
language sql stable security definer set search_path = public as $$
  select el.template_key, lower(el.to_email), max(el.created_at)
  from public.email_log el
  where el.template_key in ('localseo_gbp_access', 'webseo_gsc_access')
    and el.status = 'sent'
  group by el.template_key, lower(el.to_email);
$$;
revoke all on function public.seo_access_sent_map() from anon, public;
grant execute on function public.seo_access_sent_map() to authenticated;

-- ROLLBACK: drop function if exists public.seo_access_sent_map();
-- (the older single-template gbp_access_sent_map() is left in place, harmless.)
