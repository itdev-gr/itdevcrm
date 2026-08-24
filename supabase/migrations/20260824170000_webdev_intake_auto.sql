-- =============================================================================
-- 2026-08-24: Web Dev auto-onboarding — the client intake form email goes out
-- automatically for NEW web_dev jobs, with automatic follow-ups and an
-- escalation notification when the client never fills it in.
--
-- Mirrors the SEO onboarding machinery (20260624080000 / 20260629100000 /
-- 20260629110000): email_automation_enabled() gating, email_log/email_outbox
-- dedupe, and a cutover config so the EXISTING book can never be mass-emailed
-- (the 20260629110000 lesson). The manual send path in ClientIntakeSection /
-- useJobIntake stays untouched and remains the resend/fallback.
--
-- Switches (both OFF until the owner approves the email texts):
--   webdev_form_auto           — initial form email on new web_dev jobs (15' cron)
--   webdev_form_followup_auto  — day-3 / day-8 reminders + day-12 escalation
--                                (weekday-morning cron)
--
-- No function redefinitions in this migration (all objects are new), so no
-- pg_get_functiondef md5 pre/post capture is required.
-- =============================================================================

-- 1. The follow-up template (the initial webdev_client_form template already
--    exists from 20260714150000; this one was referenced by useJobIntake but
--    never seeded).
insert into public.email_templates (key, description, subject, body, variables, client_facing) values
('webdev_form_followup',
 'Web Dev client intake — follow-up reminder when the form has not been submitted',
 '{{code}} - Υπενθύμιση: στοιχεία για την ιστοσελίδα σας',
 E'Αγαπητέ/ή {{client_name}},\n\nΘα θέλαμε να σας υπενθυμίσουμε ότι για να προχωρήσουμε στην κατασκευή της ιστοσελίδας σας, χρειαζόμαστε τα στοιχεία και το υλικό σας μέσω της παρακάτω φόρμας:\n\n{{link}}\n\nΗ συμπλήρωση διαρκεί λίγα λεπτά και μπορείτε να επιστρέψετε αργότερα για ό,τι λείπει. Όσο πιο σύντομα λάβουμε το υλικό, τόσο πιο γρήγορα θα δείτε την ιστοσελίδα σας έτοιμη.\n\nΑν αντιμετωπίζετε οποιαδήποτε δυσκολία ή έχετε απορίες, απαντήστε σε αυτό το email ή καλέστε μας στο 210 260 3414.',
 'code, client_name, link', true)
on conflict (key) do nothing;

-- 2. Automation switches — explicitly disabled until the texts are approved.
insert into public.email_automation_settings (key, description, enabled) values
('webdev_form_auto',          'Web Dev onboarding — auto-send the intake form email on new web_dev jobs', false),
('webdev_form_followup_auto', 'Web Dev onboarding — auto follow-ups (day 3/8) + escalation (day 12) for unsubmitted intake forms', false)
on conflict (key) do nothing;

-- 3. Cutover guard: only jobs created AFTER this migration are candidates.
create table if not exists public.webdev_intake_config (
  id         boolean primary key default true check (id),
  cutover_at timestamptz not null
);
insert into public.webdev_intake_config (id, cutover_at)
  values (true, clock_timestamp())
  on conflict (id) do nothing;
alter table public.webdev_intake_config enable row level security;
revoke all on table public.webdev_intake_config from anon, authenticated;

-- 4. Pending jobs: new web_dev jobs whose intake email has not gone out.
--    SECURITY DEFINER (exposes client emails), not granted to public.
create or replace function public.webdev_intake_pending_jobs()
returns table (job_id uuid, to_email text, code text, client_name text)
language sql stable security definer set search_path = public as $$
  select j.id, c.email, j.code, c.name
    from public.jobs j
    join public.clients c on c.id = j.client_id
    left join public.job_intake_forms f on f.job_id = j.id
   where j.service_type = 'web_dev'
     and not j.archived
     and j.created_at >= (select cutover_at from public.webdev_intake_config where id)
     and coalesce(trim(c.email), '') <> ''
     and public.email_automation_enabled('webdev_form_auto')
     and (f.job_id is null or f.sent_at is null)
     and not exists (select 1 from public.email_log el
                      where el.dedupe_key = 'webdev_form_auto:' || j.id::text
                        and el.status in ('sent','delivered','bounced','complained'))
     and not exists (select 1 from public.email_outbox eo
                      where eo.dedupe_key = 'webdev_form_auto:' || j.id::text
                        and eo.status in ('pending','sending'));
$$;
revoke all on function public.webdev_intake_pending_jobs() from public;

-- 5. Initial send (15' cron): create the form row when missing (token defaults
--    server-side; created_by stays null = created by the automation), enqueue
--    the email, stamp sent_at. The link base matches PUBLIC_FORM_BASE in
--    src/features/jobs/ClientIntakeSection.tsx.
create or replace function public.process_webdev_intake_auto()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_token uuid;
  n int := 0;
begin
  for r in select * from public.webdev_intake_pending_jobs() loop
    insert into public.job_intake_forms (job_id)
      values (r.job_id)
      on conflict (job_id) do nothing;

    select token into v_token from public.job_intake_forms where job_id = r.job_id;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, 'webdev_client_form',
            jsonb_build_object('code', coalesce(r.code, ''),
                               'client_name', coalesce(r.client_name, ''),
                               'link', 'https://www.itdevcrm.com/f/' || v_token::text),
            'webdev_form_auto:' || r.job_id::text);

    update public.job_intake_forms set sent_at = now() where job_id = r.job_id and sent_at is null;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.process_webdev_intake_auto() from public;

-- 6. Follow-ups + escalation (weekday-morning cron). Day 3 and day 8 reminders
--    (dedupe :1 / :2 — never a third email), day 12 = one notification to the
--    job owner and the web_dev team lead.
create or replace function public.process_webdev_intake_followups()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_dedupe text;
  v_stage int;
  n int := 0;
begin
  if not public.email_automation_enabled('webdev_form_followup_auto') then
    return 0;
  end if;

  for r in
    select f.job_id, f.token, f.sent_at, j.code, j.owner_user_id, c.email as to_email, c.name as client_name
      from public.job_intake_forms f
      join public.jobs j on j.id = f.job_id
      join public.clients c on c.id = j.client_id
     where j.service_type = 'web_dev'
       and not j.archived
       and f.sent_at is not null
       and f.status = 'draft'
       and f.submitted_at is null
       and f.expires_at > now()
       and coalesce(trim(c.email), '') <> ''
  loop
    v_stage := case
      when r.sent_at <= now() - interval '8 days' then 2
      when r.sent_at <= now() - interval '3 days' then 1
      else 0
    end;

    -- Escalation: day 12, once per form (keyed on the notification itself).
    if r.sent_at <= now() - interval '12 days' then
      if not exists (select 1 from public.notifications
                      where type = 'webdev_form_unfilled'
                        and payload->>'job_id' = r.job_id::text) then
        insert into public.notifications (user_id, type, payload)
        select uid, 'webdev_form_unfilled',
               jsonb_build_object('job_id', r.job_id, 'code', r.code, 'client_name', r.client_name)
          from (select distinct uid from (values (r.owner_user_id), (public.team_lead_for_group('web_dev'))) t(uid)
                 where uid is not null) u;
      end if;
      continue; -- no more client emails after day 12
    end if;

    if v_stage = 0 then continue; end if;
    v_dedupe := 'webdev_form_followup:' || r.job_id::text || ':' || v_stage::text;
    if exists (select 1 from public.email_log where dedupe_key = v_dedupe
                 and status in ('sent','delivered','bounced','complained'))
       or exists (select 1 from public.email_outbox where dedupe_key = v_dedupe
                 and status in ('pending','sending')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, 'webdev_form_followup',
            jsonb_build_object('code', coalesce(r.code, ''),
                               'client_name', coalesce(r.client_name, ''),
                               'link', 'https://www.itdevcrm.com/f/' || r.token::text),
            v_dedupe);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.process_webdev_intake_followups() from public;

-- 7. Crons: initial every 15', follow-ups weekday mornings (07:00 UTC =
--    10:00/09:00 Athens).
do $$ begin perform cron.unschedule('process_webdev_intake_auto'); exception when others then null; end $$;
select cron.schedule('process_webdev_intake_auto', '*/15 * * * *',
  $$ select public.process_webdev_intake_auto(); $$);

do $$ begin perform cron.unschedule('process_webdev_intake_followups'); exception when others then null; end $$;
select cron.schedule('process_webdev_intake_followups', '0 7 * * 1-5',
  $$ select public.process_webdev_intake_followups(); $$);

-- ROLLBACK:
--   do $$ begin perform cron.unschedule('process_webdev_intake_auto'); exception when others then null; end $$;
--   do $$ begin perform cron.unschedule('process_webdev_intake_followups'); exception when others then null; end $$;
--   drop function if exists public.process_webdev_intake_followups();
--   drop function if exists public.process_webdev_intake_auto();
--   drop function if exists public.webdev_intake_pending_jobs();
--   drop table if exists public.webdev_intake_config;
--   delete from public.email_automation_settings where key in ('webdev_form_auto','webdev_form_followup_auto');
--   delete from public.email_templates where key = 'webdev_form_followup';
