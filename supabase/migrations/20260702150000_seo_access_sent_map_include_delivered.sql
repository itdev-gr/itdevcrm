-- 2026-07-02: The SEO "access email sent?" badge on job cards was wrong for
-- almost everyone. seo_access_sent_map() (which drives the badge via the
-- useSeoAccessSentMap hook) only counted email_log rows with status = 'sent'.
-- But a successfully-sent email advances to status = 'delivered' once Resend's
-- delivery webhook lands, so the vast majority of access emails (delivered, not
-- 'sent') were invisible to the map — the map returned ~7 rows while ~62 clients
-- had actually received the email, so their jobs showed "not sent".
--
-- Fix: count 'delivered' as sent too (matching how the onboarding dedupe already
-- treats sent/delivered as "already sent"). 'failed' correctly stays excluded so
-- those jobs still read "not sent" and can be retried. No data backfill needed —
-- the badge is computed live from this function.

create or replace function public.seo_access_sent_map()
returns table (template_key text, to_email text, last_sent timestamptz)
language sql stable security definer set search_path = public as $$
  select el.template_key, lower(el.to_email), max(el.created_at)
  from public.email_log el
  where el.template_key in ('localseo_gbp_access', 'webseo_gsc_access')
    and el.status in ('sent', 'delivered')
  group by el.template_key, lower(el.to_email);
$$;
revoke all on function public.seo_access_sent_map() from anon, public;
grant execute on function public.seo_access_sent_map() to authenticated;

-- ROLLBACK: restore the status = 'sent' predicate from 20260626110000.
