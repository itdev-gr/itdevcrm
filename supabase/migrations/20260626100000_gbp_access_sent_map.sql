-- 20260626100000_gbp_access_sent_map.sql
-- Read-only helper so non-admin staff (Local SEO team) can see which clients have
-- already received the localseo_gbp_access email. email_log itself is admin-read only.
create or replace function public.gbp_access_sent_map()
returns table (to_email text, last_sent timestamptz)
language sql stable security definer set search_path = public as $$
  select lower(el.to_email), max(el.created_at)
  from public.email_log el
  where el.template_key = 'localseo_gbp_access' and el.status = 'sent'
  group by lower(el.to_email);
$$;
revoke all on function public.gbp_access_sent_map() from anon, public;
grant execute on function public.gbp_access_sent_map() to authenticated;

-- ROLLBACK: drop function if exists public.gbp_access_sent_map();
