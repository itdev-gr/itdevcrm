-- =============================================================================
-- 2026-08-28: The owner approved the previewed Welcome email as THE welcome
-- for new leads everywhere:
--   1. UD pipeline: new `ud_welcome` template + email step at position 5 of
--      the ud_first_call cadence — fires immediately when a lead lands on
--      «Νέος Πελάτης» (before the 1st Call task; the engine loop sends a due
--      email step and continues to the task in the same pass).
--   2. Classic pipeline: `lead_welcome` (fires on Unique Lead entry, wiring
--      unchanged) gets the same copy.
-- No sign-off in bodies — both routes send via the owner's Gmail, which
-- appends the personal signature (rule of 20260828170000).
-- =============================================================================

insert into public.email_templates (key, description, subject, body)
values (
  'ud_welcome',
  'UD welcome — φεύγει αμέσως με την ανάθεση νέου lead (ΡΟΗ_ΝΕΟΥ_LEAD + owner 2026-08-28)',
  'ITDEV | Ευχαριστούμε για το ενδιαφέρον σας - {{name}} ({{code}})',
  'Καλησπέρα σας,

Σας ευχαριστούμε που επικοινωνήσατε μαζί μας και εκδηλώσατε το ενδιαφέρον σας για τις υπηρεσίες της ITDEV.

Είμαστε ένα digital agency με έδρα την Αθήνα και εξειδικευόμαστε στον σχεδιασμό σύγχρονων ιστοσελίδων, eshop και σε στρατηγικές digital marketing που βοηθούν τις επιχειρήσεις να αναπτυχθούν ψηφιακά.

Σύντομα ένας εκπρόσωπός μας θα επικοινωνήσει μαζί σας στο τηλέφωνο που δηλώσατε, ώστε να συζητήσετε αναλυτικότερα τις ανάγκες σας.

Παραμένουμε στη διάθεσή σας.'
)
on conflict (key) do update set description = excluded.description, subject = excluded.subject, body = excluded.body;

insert into public.ud_cadence_steps (cadence_id, position, kind, delay_days, delay_hours, template_key)
select c.id, 5, 'email', 0, 0, 'ud_welcome'
from public.ud_cadences c
where c.key = 'ud_first_call'
  and not exists (select 1 from public.ud_cadence_steps s where s.cadence_id = c.id and s.position = 5);

update public.email_templates set
  subject = 'ITDEV | Ευχαριστούμε για το ενδιαφέρον σας - {{name}} ({{code}})',
  body = 'Καλησπέρα σας,

Σας ευχαριστούμε που επικοινωνήσατε μαζί μας και εκδηλώσατε το ενδιαφέρον σας για τις υπηρεσίες της ITDEV.

Είμαστε ένα digital agency με έδρα την Αθήνα και εξειδικευόμαστε στον σχεδιασμό σύγχρονων ιστοσελίδων, eshop και σε στρατηγικές digital marketing που βοηθούν τις επιχειρήσεις να αναπτυχθούν ψηφιακά.

Σύντομα ένας εκπρόσωπός μας θα επικοινωνήσει μαζί σας στο τηλέφωνο που δηλώσατε, ώστε να συζητήσετε αναλυτικότερα τις ανάγκες σας.

Παραμένουμε στη διάθεσή σας.'
where key = 'lead_welcome';

-- ROLLBACK:
--   delete from public.ud_cadence_steps where template_key = 'ud_welcome';
--   delete from public.email_templates where key = 'ud_welcome';
--   lead_welcome: restore previous copy from the admin email-automations
--   history / 20260616-era seed (DB rows are authoritative).
