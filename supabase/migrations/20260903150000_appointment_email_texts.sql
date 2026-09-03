-- =============================================================================
-- 2026-09-03 (owner): the owner's final copy for the three appointment emails
-- (scheduled_confirm / scheduled_reminder / scheduled_noshow), replacing the
-- earlier informal revision.
--
-- These three are LIVE and sending daily (83 confirmations logged, the last one
-- 2026-09-03 08:51; reminder + no-show fired 06:30 the same morning) — the
-- «left OFF pending rework» note in 20260626000001 is stale.
--
-- Subject shape follows the UD convention already used by the ud_* rows:
--   «ITDEV | <τίτλος> - {{name}} ({{code}}) - {{scheduled_for}}»
-- The old rows carried the one-off «{{code}} - » prefix from 20260624090000;
-- that was a one-time UPDATE, not a render-time rule, so the code now simply
-- lives in the parentheses instead.
--
-- Bodies end at «Με εκτίμηση,» on purpose: these keys are in
-- SALES_OWNER_TEMPLATES, so send-email sends them from the lead owner's own
-- Gmail and appends that person's signature block (name/title/phone/email).
-- A sign-off inside the body would double it.
--
-- 1. lead_email_payload gains scheduled_date + scheduled_time
--    ------------------------------------------------------------------------
--    The copy asks for the date and the time in two separate slots
--    («για την [Ημερομηνία] και ώρα [Ώρα]»), and the only variable available
--    was the combined {{scheduled_for}} = 'DD/MM/YYYY HH24:MI'.
--    Base body: the LIVE definition, md5 668cb489df2da105eca2021c99c34430
--    (which already carries `phone` — the repo's last emission,
--    20260825170000, predates that and is NOT the base).
--    Post-md5 after applying: 7755d9417a5f731269281e3bf14ffbc3.
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
    'scheduled_for', coalesce(to_char(l.scheduled_for, 'DD/MM/YYYY HH24:MI'), ''),
    'scheduled_date', coalesce(to_char(l.scheduled_for, 'DD/MM/YYYY'), ''),
    'scheduled_time', coalesce(to_char(l.scheduled_for, 'HH24:MI'), ''),
    'lead_id', l.id,
    'unsubscribe_token', l.unsubscribe_token
  );
$function$;

-- 2. The three template rows ---------------------------------------------------

update public.email_templates set
  subject = 'ITDEV | Επιβεβαίωση Ραντεβού - {{name}} ({{code}}) - {{scheduled_for}}',
  body = E'Καλησπέρα σας,\n\nΘα θέλαμε να σας επιβεβαιώσουμε το προγραμματισμένο ραντεβού μας για την {{scheduled_date}} και ώρα {{scheduled_time}}.\n\nΠαρακαλούμε ενημερώστε μας εάν χρειαστεί να πραγματοποιηθεί οποιαδήποτε αλλαγή στην ημερομηνία ή την ώρα της επικοινωνίας μας.\n\nΠαραμένουμε στη διάθεσή σας για οποιαδήποτε διευκρίνιση.\n\nΜε εκτίμηση,',
  variables = 'code, name, scheduled_for, scheduled_date, scheduled_time',
  updated_at = now()
where key = 'scheduled_confirm';

update public.email_templates set
  subject = 'ITDEV | Υπενθύμιση Ραντεβού - {{name}} ({{code}}) - {{scheduled_for}}',
  body = E'Καλησπέρα σας,\n\nΘα θέλαμε να σας υπενθυμίσουμε το προγραμματισμένο ραντεβού μας για την {{scheduled_date}} και ώρα {{scheduled_time}}.\nΣε περίπτωση που χρειαστεί να μεταβάλετε την ώρα ή την ημερομηνία της επικοινωνίας μας, παρακαλούμε ενημερώστε μας.\n\nΑνυπομονούμε να επικοινωνήσουμε μαζί σας.\n\nΜε εκτίμηση,',
  variables = 'code, name, scheduled_for, scheduled_date, scheduled_time',
  updated_at = now()
where key = 'scheduled_reminder';

-- NOTE on the no-show wording: the owner's draft said «τη σημερινή μας
-- επικοινωνία» / «για σήμερα», but this email is enqueued by the 06:30 cron for
-- an appointment that was YESTERDAY (scheduled_for::date = current_date - 1).
-- Sending «για σήμερα» next to yesterday's rendered date would contradict
-- itself, so the two «σήμερα» references are date-driven instead. Everything
-- else is the owner's text verbatim. If the owner would rather keep «σήμερα»,
-- the fix is to move the send to the same evening, not to change the copy back.
update public.email_templates set
  subject = 'ITDEV | Σχετικά με την επικοινωνία μας - {{name}} ({{code}}) - {{scheduled_for}}',
  body = E'Καλησπέρα σας,\n\nΕπικοινωνούμε μαζί σας σχετικά με το ραντεβού που είχαμε προγραμματίσει για τις {{scheduled_date}} και ώρα {{scheduled_time}}.\n\nΚαθώς δεν καταφέραμε να επικοινωνήσουμε μαζί σας, ελπίζουμε να είναι όλα καλά.\n\nΕφόσον επιθυμείτε να επαναπρογραμματίσουμε το ραντεβού μας, παρακαλούμε ενημερώστε μας για τις ημέρες και ώρες που σας εξυπηρετούν, ώστε να ορίσουμε μια νέα επικοινωνία.\n\nΠαραμένουμε στη διάθεσή σας.\n\nΜε εκτίμηση,',
  variables = 'code, name, scheduled_for, scheduled_date, scheduled_time',
  updated_at = now()
where key = 'scheduled_noshow';

-- ROLLBACK: restore the pre-2026-09-03 rows (captured live before applying).
--   update public.email_templates set
--     subject = '{{code}} - Επιβεβαίωση ραντεβού — {{scheduled_for}}',
--     body = E'Γεια σας {{name}},\n\nΣας ευχαριστούμε, που επιλέξατε την ITDEV.\n\nΤο ραντεβού μας επιβεβαιώθηκε για {{scheduled_for}}.\n\nΟ/Η εκπρόσωπος του αντίστοιχου τμήματος {{owner_name}} θα σας καλέσει για μία σχετική συζήτηση.\n\nΠαρακαλούμε αν χρειαστείτε οποιαδήποτε αλλαγή αναφορικά με το ραντεβού σας, να απαντήσετε σε αυτό το email.'
--   where key = 'scheduled_confirm';
--   (full pre-images are dumped by the deploy script before the update —
--    see scratchpad/appointment-texts-before.json)
--   And drop the two new payload keys by re-applying the md5
--   668cb489df2da105eca2021c99c34430 body.
