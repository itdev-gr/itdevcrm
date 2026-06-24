-- 20260624090000_email_subject_client_code.sql
-- =============================================================================
-- Put the client/lead/deal code on EVERY client-facing email subject:
--   "{{code}} - <original subject>"  (e.g. "000032 - Πρόσβαση στο ...").
-- The {{code}} placeholder is filled from the email's data at render time
-- (send-email interpolate()). This migration:
--   1. prefixes all client-facing template subjects with {{code}} - ,
--   2. wires `code` into the shared lead-email payload (covers every lead
--      automation: welcome, no-answer, offer, won, scheduled, re-engage),
--   3. wires `code` into the SEO onboarding trigger (webseo_gsc / localseo_gbp).
-- (Contract send passes `code` from the frontend; payment reminders — cron
-- currently disabled — get a code when re-enabled.)
-- =============================================================================

-- 1. Prefix every client-facing subject (idempotent: skip if already prefixed).
update public.email_templates
   set subject = '{{code}} - ' || subject
 where client_facing = true
   and subject not like '{{code}}%';

-- 2. Shared lead-email payload now carries the lead code.
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
    'scheduled_for', coalesce(to_char(l.scheduled_for, 'DD/MM/YYYY HH24:MI'), ''),
    'lead_id', l.id,
    'unsubscribe_token', l.unsubscribe_token
  );
$$;

-- 3. SEO onboarding trigger now passes the client (or deal) code in the data.
create or replace function public.jobs_seo_onboarding_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_setting_key text;
  v_template_key text;
  v_email text;
  v_code text;
  v_dedupe text;
begin
  if new.service_type = 'web_seo' then
    v_setting_key := 'webseo_gsc';
    v_template_key := 'webseo_gsc_access';
  elsif new.service_type = 'local_seo' then
    v_setting_key := 'localseo_gbp';
    v_template_key := 'localseo_gbp_access';
  else
    return new;
  end if;

  if not public.email_automation_enabled(v_setting_key) then
    return new;
  end if;

  select email, code into v_email, v_code from public.clients where id = new.client_id;
  if v_code is null then
    select code into v_code from public.deals where id = new.deal_id;
  end if;
  if v_email is null or trim(v_email) = '' then
    return new;
  end if;

  v_dedupe := v_setting_key || ':' || new.deal_id::text;
  if exists (select 1 from public.email_log where dedupe_key = v_dedupe and status = 'sent')
     or exists (select 1 from public.email_outbox where dedupe_key = v_dedupe and status = 'pending') then
    return new;
  end if;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('accounting', v_email, v_template_key,
          jsonb_build_object('code', coalesce(v_code, '')), v_dedupe);

  return new;
end $$;

-- ROLLBACK:
--   update public.email_templates set subject = regexp_replace(subject, '^\{\{code\}\} - ', '')
--     where client_facing = true and subject like '{{code}}%';
--   -- restore lead_email_payload from 20260610000007 (without 'code')
--   -- restore jobs_seo_onboarding_email from 20260624080000 (data = '{}'::jsonb)
