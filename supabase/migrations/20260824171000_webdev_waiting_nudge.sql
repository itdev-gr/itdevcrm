-- =============================================================================
-- 2026-08-24: Web Dev auto-nudge — polite automatic reminders to the client
-- when a web_dev job sits in "Αναμονή έγκρισης πελάτη" (waiting_client_approval)
-- or "Δεν απαντά" (no_response), with escalation to the owner + team lead.
--
-- Schedule per waiting period (measured from the moment the card ENTERED the
-- stage, via activity_log — same source the weekly report uses):
--   day 3  → nudge #1 to the client
--   day 7  → nudge #2 to the client
--   day 10 → no more client emails; ONE notification to owner + web_dev lead
-- A new waiting period (card left the stage and came back) restarts the
-- sequence: the stage-entry timestamp is part of every dedupe key.
--
-- Per-job opt-out: jobs.details.no_client_nudge = 'yes' (Info tab field).
-- Switch: email_automation_settings.webdev_waiting_nudge — OFF until the owner
-- approves the email text. Weekday-morning cron only.
--
-- No function redefinitions in this migration (all objects are new), so no
-- pg_get_functiondef md5 pre/post capture is required.
-- =============================================================================

insert into public.email_templates (key, description, subject, body, variables, client_facing) values
('webdev_waiting_nudge',
 'Web Dev — polite reminder to the client when their website project is waiting on them',
 '{{code}} - Σας περιμένουμε για να προχωρήσουμε την ιστοσελίδα σας',
 E'Αγαπητέ/ή {{client_name}},\n\nΗ κατασκευή της ιστοσελίδας σας βρίσκεται σε εξέλιξη, αυτή τη στιγμή όμως περιμένουμε κάτι από εσάς για να συνεχίσουμε (π.χ. έγκριση, υλικό ή απάντηση σε μήνυμά μας).\n\nΘα σας παρακαλούσαμε να μας απαντήσετε σε αυτό το email ή να επικοινωνήσετε μαζί μας στο 210 260 3414, ώστε να προχωρήσουμε χωρίς άλλη καθυστέρηση.\n\nΕυχαριστούμε πολύ για τη συνεργασία!',
 'code, client_name', true)
on conflict (key) do nothing;

insert into public.email_automation_settings (key, description, enabled) values
('webdev_waiting_nudge', 'Web Dev — auto reminder to the client on day 3/7 in a waiting stage, escalation day 10', false)
on conflict (key) do nothing;

-- The nudge processor. SECURITY DEFINER (reads client emails), cron-only.
create or replace function public.process_webdev_waiting_nudges()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_entered timestamptz;
  v_days numeric;
  v_stage int;
  v_dedupe text;
  n int := 0;
begin
  if not public.email_automation_enabled('webdev_waiting_nudge') then
    return 0;
  end if;

  for r in
    select j.id, j.code, j.stage_id, j.created_at, j.owner_user_id,
           c.email as to_email, c.name as client_name
      from public.jobs j
      join public.pipeline_stages s on s.id = j.stage_id
      join public.clients c on c.id = j.client_id
     where j.service_type = 'web_dev'
       and not j.archived
       and s.board = 'web_dev'
       and s.code in ('waiting_client_approval', 'no_response')
       and coalesce(trim(c.email), '') <> ''
       and coalesce(j.details->>'no_client_nudge', 'no') <> 'yes'
  loop
    -- When did the card enter its current stage? Latest stage change into the
    -- current stage from activity_log (update rows carry {'old','new'} full
    -- rows — see log_activity()); fallback: job creation.
    select coalesce(max(al.created_at), r.created_at) into v_entered
      from public.activity_log al
     where al.entity_type = 'jobs'
       and al.entity_id = r.id
       and al.action = 'update'
       and (al.changes->'new'->>'stage_id') = r.stage_id::text
       and (al.changes->'old'->>'stage_id') is distinct from (al.changes->'new'->>'stage_id');

    v_days := extract(epoch from (now() - v_entered)) / 86400;

    -- Day 10+: stop emailing, notify owner + lead once per waiting period.
    if v_days >= 10 then
      if not exists (select 1 from public.notifications
                      where type = 'webdev_client_unresponsive'
                        and payload->>'job_id' = r.id::text
                        and payload->>'entered_at' = v_entered::text) then
        insert into public.notifications (user_id, type, payload)
        select uid, 'webdev_client_unresponsive',
               jsonb_build_object('job_id', r.id, 'code', r.code,
                                  'client_name', r.client_name, 'entered_at', v_entered)
          from (select distinct uid from (values (r.owner_user_id), (public.team_lead_for_group('web_dev'))) t(uid)
                 where uid is not null) u;
      end if;
      continue;
    end if;

    v_stage := case when v_days >= 7 then 2 when v_days >= 3 then 1 else 0 end;
    if v_stage = 0 then continue; end if;

    v_dedupe := 'webdev_nudge:' || r.id::text || ':'
                || extract(epoch from v_entered)::bigint::text || ':' || v_stage::text;
    if exists (select 1 from public.email_log where dedupe_key = v_dedupe
                 and status in ('sent','delivered','bounced','complained'))
       or exists (select 1 from public.email_outbox where dedupe_key = v_dedupe
                 and status in ('pending','sending')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, 'webdev_waiting_nudge',
            jsonb_build_object('code', coalesce(r.code, ''),
                               'client_name', coalesce(r.client_name, '')),
            v_dedupe);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.process_webdev_waiting_nudges() from public;

-- Weekday mornings only (07:10 UTC = 10:10/09:10 Athens; offset from the
-- intake follow-up cron).
do $$ begin perform cron.unschedule('process_webdev_waiting_nudges'); exception when others then null; end $$;
select cron.schedule('process_webdev_waiting_nudges', '10 7 * * 1-5',
  $$ select public.process_webdev_waiting_nudges(); $$);

-- ROLLBACK:
--   do $$ begin perform cron.unschedule('process_webdev_waiting_nudges'); exception when others then null; end $$;
--   drop function if exists public.process_webdev_waiting_nudges();
--   delete from public.email_automation_settings where key = 'webdev_waiting_nudge';
--   delete from public.email_templates where key = 'webdev_waiting_nudge';
