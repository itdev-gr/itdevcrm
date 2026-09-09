-- =============================================================================
-- 20260909120000_email_contact_greeting_and_code_suffix.sql
-- Feedback owner 2026-09-09 (παράδειγμα 000042): το webdev_waiting_nudge
-- χαιρετούσε «Αγαπητέ/ή ATKO ΜΕΛΕΤΗΤΙΚΗ ΚΑΤΑΣΚΕΥΑΣΤΙΚΗ…» — επωνυμία αντί για
-- το primary contact. Αποφάσεις:
--
-- 1. Και τα 3 web dev client emails (webdev_client_form, webdev_form_followup,
--    webdev_waiting_nudge) χαιρετούν με το ΜΙΚΡΟ ΟΝΟΜΑ του primary contact
--    (clients.contact_first_name), με fallback την επωνυμία — το ίδιο pattern
--    με τα sales (lead_email_payload, 20260903150000).
-- 2. Ο κωδικός φεύγει από το πρόθεμα του θέματος («{{code}} - …», κανόνας του
--    20260624090000) και πάει στο ΤΕΛΟΣ («… ({{code}})») όπως στα sales/UD —
--    σε ΟΛΑ τα client-facing templates που είχαν το πρόθεμα. Το inbox filing
--    (resolve_email_filing) κάνει match τον job code ΟΠΟΥΔΗΠΟΤΕ στο subject
--    (regex \d{6}-[A-Z]{3,}), άρα η μετακίνηση είναι ασφαλής. Οι ΤΙΜΕΣ των
--    κωδικών δεν αλλάζουν (job code στα job-scoped, deal/lead αλλού).
--    Συνοδεύεται από guard στο send-email/templates.ts (cleanSubject αφαιρεί
--    κενά «()» όταν το {{code}} interpolάρει σε κενό) και από το append-at-send
--    στα χειροκίνητα/offer emails (SendEmailDialog) — frontend, ίδιο commit.
--
-- Redefines (drift-check md5(pg_get_functiondef) γίνεται από το apply script
-- πριν τρέξει το αρχείο — οι τρεις συναρτήσεις ορίζονται ΜΟΝΟ στα
-- 20260824170000/171000, καμία μεταγενέστερη εκδοχή στο repo):
--   webdev_intake_pending_jobs()        — τροφοδοτεί το αρχικό webdev_client_form
--   process_webdev_waiting_nudges()
--   process_webdev_intake_followups()
-- (Το process_webdev_intake_auto δεν αλλάζει: παίρνει το όνομα έτοιμο από το
--  webdev_intake_pending_jobs.)
-- =============================================================================

-- --- 1. Greeting: primary contact first name, fallback στην επωνυμία ---------

-- Σώμα από 20260824170000 §4· μόνο η στήλη client_name αλλάζει.
create or replace function public.webdev_intake_pending_jobs()
returns table (job_id uuid, to_email text, code text, client_name text)
language sql stable security definer set search_path = public as $$
  select j.id, c.email, j.code,
         coalesce(nullif(trim(c.contact_first_name), ''), c.name)
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

-- Σώμα από 20260824171000· μόνο το client_name του κύριου select αλλάζει (το
-- escalation notification κρατά σκόπιμα την ίδια τιμή — εκεί το «όνομα» είναι
-- πλέον η επαφή, που είναι και το πρόσωπο που δεν απαντά).
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
           c.email as to_email,
           coalesce(nullif(trim(c.contact_first_name), ''), c.name) as client_name
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

-- Σώμα από 20260824170000 §6· μόνο το client_name του select αλλάζει.
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
    select f.job_id, f.token, f.sent_at, j.code, j.owner_user_id, c.email as to_email,
           coalesce(nullif(trim(c.contact_first_name), ''), c.name) as client_name
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

-- --- 2. Subject: «{{code}} - …» πρόθεμα → «… ({{code}})» κατάληξη -------------
-- Πιάνει ό,τι σημάδεψε το 20260624090000 και ακόμα το κουβαλάει: won_welcome,
-- won_next_steps, webseo_gsc_access/followup, localseo_gbp_access/followup,
-- webdev_client_form, webdev_form_followup, webdev_waiting_nudge,
-- payment_due_soon/overdue/final_notice, contract_send. Τα ud_*/lead_welcome/
-- scheduled_* έχουν ήδη ({{code}}) και δεν ταιριάζουν στο LIKE· τα internal
-- (client_facing=false) μένουν απείραχτα. Τα σε-αναμονή email_outbox rows
-- παίρνουν αυτόματα το νέο subject (το template διαβάζεται στο render).
-- substring από τον 12ο χαρακτήρα = μετά το '{{code}} - ' (11 χαρακτήρες).
update public.email_templates
   set subject = trim(substring(subject from 12)) || ' ({{code}})',
       updated_at = now()
 where client_facing = true
   and subject like '{{code}} - %';

-- ROLLBACK:
--   update public.email_templates
--      set subject = '{{code}} - ' || trim(regexp_replace(subject, '\s*\(\{\{code\}\}\)$', ''))
--    where key in ('won_welcome','won_next_steps','webseo_gsc_access','webseo_gsc_followup',
--                  'localseo_gbp_access','localseo_gbp_followup','webdev_client_form',
--                  'webdev_form_followup','webdev_waiting_nudge','payment_due_soon',
--                  'payment_overdue','payment_final_notice','contract_send');
--   (ΟΧΙ γενικό LIKE '%({{code}})' — θα έπιανε και τα ud_*/lead_welcome που το
--    είχαν από πάντα.)
--   Και ξανατρέξε τα function bodies των 20260824170000 (§4, §6) και 20260824171000.
