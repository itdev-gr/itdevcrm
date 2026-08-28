-- =============================================================================
-- 2026-08-28: Align the Under Development pipeline with the owner's official
-- flow document (ΡΟΗ_ΝΕΟΥ_LEAD.docx) and install the final email copy.
-- Owner decision: applies ONLY to the UD board — the classic sales pipeline's
-- templates/sequences are untouched.
--
-- 1. Cadence engine gains HOUR granularity (delay_hours) — needed for the
--    doc's rule «2nd Call μόνο αν δεν απαντήσει στο 1st Call μετά από 4 ώρες».
-- 2. ud_first_call gains the «2nd Call» step (+4h after 1st Call closes
--    «Δεν απάντησε»).
-- 3. ud_offer_followup tail reordered per the doc: the final email
--    («Τελευταία επικοινωνία») fires AFTER the final callback (T+8), then the
--    chain exhausts toward Not Interested.
-- 4. lead_email_payload gains 'phone' (the texts reference the number dialed).
-- 5. The six ud_* placeholder templates receive the owner's final copy; new
--    ud_offer_email_intro/outro power the UD-only offer email (board-aware
--    OfferEmailDialog). No sign-offs in bodies — the personal-Gmail transport
--    appends the sender's signature (rule of 20260828170000).
--
-- Redefinitions (live bodies pulled 2026-08-28, md5 pre/post in deploy output):
--   ud_advance_run     pre 9c775905c6a56da5d6e81d809b09cfae  (base 20260826150000)
--   lead_email_payload pre d470a9b75b1d90f1e095c31eb411a962  (base 20260825170000
--                      + industry from 20260721100000)
-- Bodies below are the LIVE definitions verbatim; only the marked lines change.
-- =============================================================================

-- 1. Hour granularity ---------------------------------------------------------
alter table public.ud_cadence_steps
  add column if not exists delay_hours int not null default 0
  check (delay_hours >= 0 and delay_hours < 24);

CREATE OR REPLACE FUNCTION public.ud_advance_run(p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.ud_cadence_runs;
  s public.ud_cadence_steps;
  l public.leads;
  v_assignee uuid;
  v_due timestamptz;
  v_task_id uuid;
begin
  loop
    select * into r from public.ud_cadence_runs where id = p_run_id for update;
    if r is null or r.status <> 'active' then return; end if;

    select * into s from public.ud_cadence_steps
     where cadence_id = r.cadence_id and position > r.current_position and enabled
     order by position limit 1;

    if s is null then
      -- Chain fully processed (only reachable when the last step is an email;
      -- a final task's exhaustion is reported by ud_complete_cadence_task).
      update public.ud_cadence_runs
         set status = 'completed', exhausted_at = now(), next_event_at = null
       where id = p_run_id;
      return;
    end if;

    if s.kind = 'email' then
      -- 2026-08-28 doc-alignment: hours joined days in the delay arithmetic.
      v_due := r.last_event_at + make_interval(days => s.delay_days, hours => s.delay_hours);
      if v_due <= now() then
        if public.email_automation_enabled('dept_sales') then
          perform public.enqueue_lead_email(
            r.lead_id, s.template_key,
            'udcad:' || r.lead_id || ':' || s.id || ':' || r.id);
        end if;
        update public.ud_cadence_runs
           set current_position = s.position, last_event_at = now(), next_event_at = null
         where id = p_run_id;
        -- loop on to the next step
      else
        update public.ud_cadence_runs set next_event_at = v_due where id = p_run_id;
        return;
      end if;
    else
      select * into l from public.leads where id = r.lead_id;
      v_assignee := coalesce(l.owner_user_id, l.created_by);
      if v_assignee is null then
        -- No one to work the task: park (chain resumes if re-entered with an owner).
        update public.ud_cadence_runs set next_event_at = null where id = p_run_id;
        return;
      end if;
      -- 2026-08-28 doc-alignment: hours joined days in the delay arithmetic.
      v_due := greatest(now(), r.last_event_at + make_interval(days => s.delay_days, hours => s.delay_hours));
      insert into public.user_tasks
        (user_id, created_by, title, notes, due_at, importance, lead_id,
         cadence_run_id, cadence_step_id)
      values
        (v_assignee, v_assignee,
         coalesce(s.titles ->> 'el', s.titles ->> 'en', 'Cadence task'),
         'Αυτόματο task ροής Under Development — κλείνει με «Μίλησα» ή «Δεν απάντησε» από την καρτέλα του lead.',
         v_due, 'high', r.lead_id, r.id, s.id)
      returning id into v_task_id;
      update public.ud_cadence_runs
         set current_position = s.position, current_task_id = v_task_id, next_event_at = null
       where id = p_run_id;
      return;
    end if;
  end loop;
end $function$;

-- 2. «2nd Call» step: 4 hours after 1st Call closes «Δεν απάντησε» ------------
insert into public.ud_cadence_steps (cadence_id, position, kind, delay_days, delay_hours, titles)
select c.id, 20, 'task', 0, 4, '{"en": "2nd Call", "el": "2η Κλήση"}'::jsonb
from public.ud_cadences c
where c.key = 'ud_first_call'
  and not exists (select 1 from public.ud_cadence_steps s where s.cadence_id = c.id and s.position = 20);

-- 3. Offer tail per the doc: final email AFTER the final callback (T+8) -------
-- Current: 50=email ud_offer_followup_2 (+0), 60=task Τελευταίο (+3).
-- Target:  50=task Τελευταίο Follow-up Callback (+2 ⇒ T+8), 60=email (+0).
update public.ud_cadence_steps s set position = 65
from public.ud_cadences c
where c.id = s.cadence_id and c.key = 'ud_offer_followup'
  and s.position = 50 and s.kind = 'email' and s.template_key = 'ud_offer_followup_2';
update public.ud_cadence_steps s set position = 50, delay_days = 2
from public.ud_cadences c
where c.id = s.cadence_id and c.key = 'ud_offer_followup'
  and s.position = 60 and s.kind = 'task';
update public.ud_cadence_steps s set position = 60, delay_days = 0
from public.ud_cadences c
where c.id = s.cadence_id and c.key = 'ud_offer_followup'
  and s.position = 65 and s.kind = 'email';

-- 4. Phone in the lead email payload ------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_email_payload(l leads)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'lead_id', l.id,
    'unsubscribe_token', l.unsubscribe_token
  );
$function$;

-- 5. Final email copy (owner's texts, ΡΟΗ_ΝΕΟΥ_LEAD + chat 2026-08-28).
--    No trailing sign-off: the personal-Gmail transport appends the sender's
--    signature (Με εκτίμηση + name), rule established in 20260828170000.
update public.email_templates set
  subject = 'ITDEV | Προσπάθεια επικοινωνίας - {{name}} ({{code}})',
  body = 'Καλησπέρα σας,

Αρχικά, θα θέλαμε να σας ευχαριστήσουμε για το ενδιαφέρον σας για τις υπηρεσίες της ITDEV. Είμαστε ένα digital agency με έδρα την Αθήνα και εξειδικευόμαστε στον σχεδιασμό σύγχρονων ιστοσελίδων, eshop και σε στρατηγικές digital marketing που βοηθούν τις επιχειρήσεις να αναπτυχθούν ψηφιακά.

Προσπαθήσαμε να επικοινωνήσουμε μαζί σας στο {{phone}}, αλλά δεν κατέστη δυνατό να σας βρούμε.

Παρακαλούμε ενημερώστε μας για τη διαθεσιμότητά σας, ώστε να καλέσουμε εκ νέου για να συζητήσουμε τις ανάγκες σας.'
where key = 'ud_noanswer_1';

update public.email_templates set
  subject = 'ITDEV | Προσπάθεια επικοινωνίας - {{name}} ({{code}})',
  body = 'Καλησπέρα σας,

Θα θέλαμε να σας ενημερώσουμε πως προσπαθήσαμε να επικοινωνήσουμε εκ νέου μαζί σας στο {{phone}}, αλλά δεν κατέστη δυνατό να σας βρούμε.

Παρακαλούμε να μας ενημερώσετε για τις ημέρες και ώρες που σας εξυπηρετούν, ώστε να επικοινωνήσουμε ξανά μαζί σας και να συζητήσουμε τις ανάγκες σας.

Εναλλακτικά, μπορείτε να μας απαντήσετε απευθείας σε αυτό το email με λίγα λόγια για το τι αναζητάτε, ώστε να σας αποστείλουμε αρχικές πληροφορίες.'
where key = 'ud_noanswer_2';

update public.email_templates set
  subject = 'ITDEV | Τελευταία Προσπάθεια Επικοινωνίας - {{name}} ({{code}})',
  body = 'Καλησπέρα σας,

Θα θέλαμε να σας ενημερώσουμε πως, παρά τις επανειλημμένες προσπάθειες, δεν κατέστη δυνατό να επικοινωνήσουμε μαζί σας τηλεφωνικά.

Θα πραγματοποιήσουμε μία τελευταία προσπάθεια κλήσης τις επόμενες ημέρες, ώστε να μπορέσουμε να συζητήσουμε αναλυτικότερα τις ανάγκες σας.

Εάν το επιθυμείτε, μπορείτε να μας απαντήσετε σε αυτό το email ενημερώνοντάς μας για τη διαθεσιμότητά σας, ώστε να προγραμματίσουμε τη συνομιλία μας.'
where key = 'ud_noanswer_3';

update public.email_templates set
  subject = 'ITDEV | Επικοινωνία σχετικά με την προσφορά - {{name}} ({{code}})',
  body = 'Καλησπέρα σας,

Ελπίζω να είστε καλά.

Επικοινωνώ σε συνέχεια της προσφοράς που σας αποστείλαμε πρόσφατα για τις υπηρεσίες μας. Θα θέλαμε να μάθουμε αν είχατε την ευκαιρία να την εξετάσετε και αν χρειάζεστε κάποια επιπλέον διευκρίνιση.

Παραμένουμε στη διάθεσή σας για να συζητήσουμε οποιαδήποτε απορία ή να αναπροσαρμόσουμε την πρότασή μας σύμφωνα με τις ανάγκες σας.'
where key = 'ud_offer_checkin';

update public.email_templates set
  subject = 'ITDEV | Τηλεφωνική επικοινωνία & Προσφορά - {{name}} ({{code}})',
  body = 'Καλησπέρα σας,

Προσπάθησα να σας καλέσω νωρίτερα, αλλά δεν κατέστη δυνατό να συνομιλήσουμε.

Επανέρχομαι απλά για να βεβαιωθώ ότι λάβατε τα προηγούμενα μηνύματά μας σχετικά με την προσφορά που έχετε λάβει.

Παρακαλώ ενημερώστε μας αν χρειάζεστε κάποια διευκρίνιση ή αν θα σας εξυπηρετούσε να μιλήσουμε εκ νέου στο τηλέφωνο.'
where key = 'ud_offer_followup_1';

update public.email_templates set
  subject = 'ITDEV | Τελευταία επικοινωνία σχετικά με την προσφορά μας - {{name}} ({{code}})',
  body = 'Καλησπέρα σας,

Προσπάθησα να σας καλέσω νωρίτερα, χωρίς όμως να μπορέσουμε να συνομιλήσουμε.

Καθώς έχουμε αποστείλει την προσφορά μας και έχουμε πραγματοποιήσει ορισμένες προσπάθειες επικοινωνίας, κατανοώ απόλυτα πως το πρόγραμμά σας ενδέχεται να είναι ιδιαίτερα πιεσμένο αυτή τη στιγμή.

Διευκρινίζω πως δεν θα σας ενοχλήσω εκ νέου. Αν ωστόσο το έργο παραμένει στα σχέδιά σας και χρειάζεστε οποιαδήποτε διευκρίνιση ή προσαρμογή στην πρότασή μας, μπορείτε να απαντήσετε σε αυτό το email ή να μας καλέσετε όποτε σας εξυπηρετεί.

Σας ευχαριστούμε θερμά για το ενδιαφέρον σας για τις υπηρεσίες της ITDEV.'
where key = 'ud_offer_followup_2';

-- UD-only offer email (board-aware OfferEmailDialog). Subject = email subject;
-- body vars limited to the composer set (name/owner_name/offer_number/
-- validity_days/offer_url/code — code added to the composer in this change).
insert into public.email_templates (key, description, subject, body)
values (
  'ud_offer_email_intro',
  'UD offer email — εισαγωγή με το δημόσιο link (ΡΟΗ_ΝΕΟΥ_LEAD)',
  'ITDEV Προσφορά | {{name}} ({{code}})',
  'Καλησπέρα σας,

Αρχικά, θα θέλαμε να σας ευχαριστήσουμε για το ενδιαφέρον σας για τις υπηρεσίες της ITDEV.

Σε συνέχεια της επικοινωνίας μας, θα βρείτε παρακάτω την προσφορά που συζητήσαμε:
{{offer_url}}'
)
on conflict (key) do update set subject = excluded.subject, body = excluded.body;

insert into public.email_templates (key, description, subject, body)
values (
  'ud_offer_email_outro',
  'UD offer email — κατακλείδα (χωρίς υπογραφή, την προσθέτει το Gmail)',
  '(κατακλείδα — δεν εμφανίζεται στο email)',
  'Παραμένουμε στη διάθεσή σας για οποιαδήποτε διευκρίνιση.'
)
on conflict (key) do update set subject = excluded.subject, body = excluded.body;

-- ROLLBACK:
--   Steps: delete the ud_first_call position-20 row; restore ud_offer_followup
--   positions (email back to 50 delay 0, task back to 60 delay 3).
--   alter table public.ud_cadence_steps drop column if exists delay_hours;
--   ud_advance_run / lead_email_payload: restore the pre-md5 bodies recorded above.
--   delete from public.email_templates where key in ('ud_offer_email_intro','ud_offer_email_outro');
--   Template copy: previous placeholders are in 20260826150000.
