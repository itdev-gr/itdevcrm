-- =============================================================================
-- 2026-09-03 (owner: «οι ώρες στα email είναι 3 ώρες πριν»): appointment times
-- rendered in UTC instead of Athens time.
--
-- The database runs with TimeZone = UTC, so to_char() on a timestamptz formats
-- the UTC wall clock. leads.scheduled_for is timestamptz, so an appointment the
-- rep booked for 15:00 Athens went out in the email as 12:00 (-3h in summer,
-- -2h in winter). The stored value was always correct — only the rendering was
-- wrong, so no data needs repairing.
--
-- Fixes all three display keys in lead_email_payload. These feed
-- scheduled_confirm / scheduled_reminder / scheduled_noshow, i.e. every email
-- that prints an appointment time.
--
-- Base body: md5 7755d9417a5f731269281e3bf14ffbc3 (emitted by 20260903150000).
--
-- DELIBERATELY NOT TOUCHED — these to_char calls are dedupe keys, not display:
--   * leads_email_automations: 'scheduled_confirm:<id>:' ||
--     to_char(new.scheduled_for,'YYYYMMDDHH24MI'). Shifting it by three hours
--     would mint a NEW key for every lead that already has a confirmation
--     logged, and the next scheduled_for touch would re-send a duplicate
--     confirmation to the client.
--   * process_email_sequences: to_char(current_date ± 1,'YYYYMMDD') — a date,
--     no timezone component, and also a dedupe key.
-- Checked and genuinely unaffected: enqueue_payment_reminders and
-- mark_overdue_payments format jobs.period_due_date, which is a `date`.
-- =============================================================================

create or replace function public.lead_email_payload(l public.leads)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'code', coalesce(l.code, ''),
    'name', coalesce(nullif(trim(l.contact_first_name), ''), l.company_name, ''),
    'company', coalesce(l.company_name, ''),
    'industry', coalesce(l.industry, ''),
    'phone', coalesce(l.phone, ''),
    'owner_name', coalesce(
      (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.user_id = l.owner_user_id),
      'η ομάδα μας'),
    'owner_email', coalesce(
      (select p.email from public.profiles p where p.user_id = l.owner_user_id), ''),
    'owner_user_id', l.owner_user_id,
    -- Athens wall clock: the DB session is UTC, and these strings are read by
    -- the client, not by code.
    'scheduled_for', coalesce(to_char(l.scheduled_for at time zone 'Europe/Athens', 'DD/MM/YYYY HH24:MI'), ''),
    'scheduled_date', coalesce(to_char(l.scheduled_for at time zone 'Europe/Athens', 'DD/MM/YYYY'), ''),
    'scheduled_time', coalesce(to_char(l.scheduled_for at time zone 'Europe/Athens', 'HH24:MI'), ''),
    'lead_id', l.id,
    'unsubscribe_token', l.unsubscribe_token
  );
$function$;

-- ROLLBACK: re-apply the 20260903150000 body (md5 7755d9417a5f731269281e3bf14ffbc3),
-- i.e. drop the three `at time zone 'Europe/Athens'` clauses.
