-- 20260624120000_lead_payload_owner_email.sql
-- Add owner_email to the shared lead-email payload so the send-email function can
-- CC the assigned rep on the sales welcome (lead_welcome). It's just data — only
-- the lead_welcome branch in send-email uses it, so other lead emails are
-- unaffected.
create or replace function public.lead_email_payload(l public.leads)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', coalesce(l.code, ''),
    'name', coalesce(nullif(trim(l.contact_first_name), ''), l.company_name, ''),
    'company', coalesce(l.company_name, ''),
    'industry', coalesce(l.industry, ''),
    'owner_name', coalesce(
      (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.user_id = l.owner_user_id),
      'η ομάδα μας'),
    'owner_email', coalesce(
      (select p.email from public.profiles p where p.user_id = l.owner_user_id), ''),
    'scheduled_for', coalesce(to_char(l.scheduled_for, 'DD/MM/YYYY HH24:MI'), ''),
    'lead_id', l.id,
    'unsubscribe_token', l.unsubscribe_token
  );
$$;

-- ROLLBACK: restore lead_email_payload from 20260624090000 (without owner_email).
