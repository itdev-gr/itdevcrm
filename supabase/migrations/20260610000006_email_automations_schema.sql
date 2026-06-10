-- =============================================================================
-- Email automations, part 1/2: schema + seeds.
-- Lead-lifecycle email engine: editable templates (admin UI), configurable
-- sequences with day offsets, per-lead opt-out/kill switch, sequence run
-- state. Part 2 (20260610000007) adds the triggers + daily processor.
--
-- Rollback:
--   drop table public.lead_sequence_runs;
--   drop table public.email_sequence_steps;
--   drop table public.email_sequences;
--   drop table public.email_automation_settings;
--   drop table public.email_templates;
--   alter table public.leads
--     drop column email_opt_out,
--     drop column automations_enabled,
--     drop column unsubscribe_token;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Editable templates. The send-email edge function reads this table first and
-- falls back to its built-in templates, so seeding the payment reminder keys
-- here makes those editable too. Bodies are plain text with {{variables}};
-- newlines become <br> when rendered.
-- ---------------------------------------------------------------------------
create table public.email_templates (
  key text primary key,
  description text not null,
  subject text not null,
  body text not null,
  /** Comma list shown in the admin UI as available variables. */
  variables text not null default '',
  client_facing boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger email_templates_set_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

alter table public.email_templates enable row level security;
create policy email_templates_select on public.email_templates
  for select to authenticated using (true);
create policy email_templates_mutate_admin on public.email_templates
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- One-shot automation switches + global kill switch.
-- ---------------------------------------------------------------------------
create table public.email_automation_settings (
  key text primary key,
  description text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger email_automation_settings_set_updated_at
  before update on public.email_automation_settings
  for each row execute function public.set_updated_at();

alter table public.email_automation_settings enable row level security;
create policy email_automation_settings_select on public.email_automation_settings
  for select to authenticated using (true);
create policy email_automation_settings_mutate_admin on public.email_automation_settings
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

create or replace function public.email_automation_enabled(setting_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.email_automation_settings where key = 'global'), false)
     and coalesce((select enabled from public.email_automation_settings where key = setting_key), false);
$$;

-- ---------------------------------------------------------------------------
-- Sequences (multi-step cadences) + steps with editable day offsets.
-- ---------------------------------------------------------------------------
create table public.email_sequences (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_name text not null,
  description text not null,
  /** Lead stays in these sales-stage codes while the cadence runs. */
  active_stage_codes text[] not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.email_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.email_sequences(id) on delete cascade,
  position int not null,
  day_offset int not null check (day_offset >= 0),
  template_key text not null references public.email_templates(key),
  enabled boolean not null default true,
  unique (sequence_id, position)
);

create trigger email_sequences_set_updated_at
  before update on public.email_sequences
  for each row execute function public.set_updated_at();

alter table public.email_sequences enable row level security;
alter table public.email_sequence_steps enable row level security;
create policy email_sequences_select on public.email_sequences
  for select to authenticated using (true);
create policy email_sequences_mutate_admin on public.email_sequences
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
create policy email_sequence_steps_select on public.email_sequence_steps
  for select to authenticated using (true);
create policy email_sequence_steps_mutate_admin on public.email_sequence_steps
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- Per-lead run state. One active run per (lead, sequence).
-- ---------------------------------------------------------------------------
create table public.lead_sequence_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  sequence_id uuid not null references public.email_sequences(id) on delete cascade,
  started_on date not null default current_date,
  last_step_position int not null default 0,
  stopped_at timestamptz,
  stopped_reason text,
  created_at timestamptz not null default now()
);

create unique index lead_sequence_runs_active
  on public.lead_sequence_runs (lead_id, sequence_id)
  where stopped_at is null;

alter table public.lead_sequence_runs enable row level security;
create policy lead_sequence_runs_select on public.lead_sequence_runs
  for select to authenticated using (true);
-- Writes happen only inside security-definer functions.

-- ---------------------------------------------------------------------------
-- Lead columns: opt-out (unsubscribe link), per-lead automation switch,
-- unsubscribe token for the public endpoint.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column email_opt_out boolean not null default false,
  add column automations_enabled boolean not null default true,
  add column unsubscribe_token uuid not null default gen_random_uuid();

-- ---------------------------------------------------------------------------
-- Seeds: templates (Greek, editable in the admin UI).
-- ---------------------------------------------------------------------------
insert into public.email_templates (key, description, subject, body, variables, client_facing) values
('lead_welcome',
 'Welcome email when a new lead arrives (Meta/manual only)',
 'Καλώς ήρθατε στην ITDev, {{name}}!',
 E'Γεια σας {{name}},\n\nΣας ευχαριστούμε για το ενδιαφέρον σας! Ο συνεργάτης μας {{owner_name}} θα επικοινωνήσει μαζί σας εντός 24 ωρών.\n\nΣτο μεταξύ, μπορείτε να δείτε τις υπηρεσίες μας στο itdev.gr.\n\nΜε εκτίμηση,\nΗ ομάδα της ITDev',
 'name, company, owner_name, industry', true),

('noanswer_day0',
 'No Answer cadence — sent the day we could not reach them',
 'Προσπαθήσαμε να επικοινωνήσουμε μαζί σας',
 E'Γεια σας {{name}},\n\nΣας καλέσαμε σήμερα αλλά δεν τα καταφέραμε. Απαντήστε σε αυτό το email ή πείτε μας πότε σας βολεύει να σας καλέσουμε.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),

('noanswer_day2',
 'No Answer cadence — value email, day 2',
 'Πώς βοηθάμε επιχειρήσεις σαν τη δική σας',
 E'Γεια σας {{name}},\n\nΞέρουμε ότι οι μέρες τρέχουν. Στην ITDev βοηθάμε επιχειρήσεις στον κλάδο σας να αποκτήσουν περισσότερους πελάτες μέσω Google και social media.\n\nΑν θέλετε να δείτε τι θα κάναμε για την {{company}}, απαντήστε εδώ ή κλείστε ένα 15λεπτο τηλεφώνημα.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name, industry', true),

('noanswer_day5',
 'No Answer cadence — proof/case study, day 5',
 'Δείτε τι πετύχαμε για πελάτες μας',
 E'Γεια σας {{name}},\n\nΠρόσφατα βοηθήσαμε πελάτη μας να διπλασιάσει τις κλήσεις από το Google μέσα σε 4 μήνες.\n\nΘα χαρούμε να σας δείξουμε πώς θα δούλευε κάτι αντίστοιχο για εσάς — απαντήστε σε αυτό το email ή καλέστε μας.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),

('noanswer_day10',
 'No Answer cadence — breakup email, day 10',
 'Να κλείσουμε τον φάκελό σας;',
 E'Γεια σας {{name}},\n\nΔεν καταφέραμε να επικοινωνήσουμε, οπότε υποθέτουμε ότι ίσως δεν είναι η κατάλληλη στιγμή. Θα κλείσουμε τον φάκελό σας, εκτός αν μας πείτε διαφορετικά.\n\nΑν αλλάξει κάτι, είμαστε πάντα εδώ.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),

('offer_followup_day2',
 'Offer Sent follow-up — questions, day 2',
 'Έχετε απορίες για την προσφορά σας;',
 E'Γεια σας {{name}},\n\nΕλπίζουμε να είδατε την προσφορά που σας στείλαμε. Αν έχετε οποιαδήποτε απορία, θα χαρώ να τη συζητήσουμε — απαντήστε εδώ ή καλέστε με.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),

('offer_followup_day5',
 'Offer Sent follow-up — nudge, day 5',
 'Η προσφορά σας από την ITDev',
 E'Γεια σας {{name}},\n\nΜια υπενθύμιση για την προσφορά που σας έχουμε στείλει. Θα χαρούμε να προχωρήσουμε μαζί — αν θέλετε κάποια προσαρμογή, πείτε μας.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),

('offer_followup_day10',
 'Offer Sent follow-up — final, day 10',
 'Τελευταία υπενθύμιση για την προσφορά σας',
 E'Γεια σας {{name}},\n\nΔεν θέλουμε να σας ενοχλούμε — αυτή είναι η τελευταία μας υπενθύμιση για την προσφορά. Αν θέλετε να τη συζητήσουμε ή να την αναπροσαρμόσουμε, είμαστε στη διάθεσή σας.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),

('scheduled_confirm',
 'Sent when a call/meeting is booked',
 'Επιβεβαίωση ραντεβού — {{scheduled_for}}',
 E'Γεια σας {{name}},\n\nΤο ραντεβού μας επιβεβαιώθηκε για {{scheduled_for}}.\n\nΘα σας καλέσει ο/η {{owner_name}}. Αν χρειαστεί αλλαγή, απαντήστε σε αυτό το email.\n\nΜε εκτίμηση,\nITDev',
 'name, owner_name, scheduled_for', true),

('scheduled_reminder',
 'Reminder the day before a booked call',
 'Υπενθύμιση: το ραντεβού μας αύριο',
 E'Γεια σας {{name}},\n\nΜια φιλική υπενθύμιση για το ραντεβού μας αύριο, {{scheduled_for}}.\n\nΤα λέμε σύντομα!\n{{owner_name}}\nITDev',
 'name, owner_name, scheduled_for', true),

('scheduled_noshow',
 'Sent the day after a missed call',
 'Δεν τα καταφέραμε χθες — να ξανακλείσουμε;',
 E'Γεια σας {{name}},\n\nΧθες δεν καταφέραμε να μιλήσουμε. Κανένα πρόβλημα — πείτε μας πότε σας βολεύει και θα ξανακλείσουμε το ραντεβού.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, owner_name', true),

('won_welcome',
 'Automatic welcome when a lead becomes a client (Won)',
 'Καλώς ήρθατε στην ITDev! 🎉',
 E'Γεια σας {{name}},\n\nΧαιρόμαστε πολύ που ξεκινάμε τη συνεργασία μας!\n\nΟ/Η {{owner_name}} παραμένει το πρόσωπο επαφής σας για οτιδήποτε χρειαστείτε.\n\nΜε εκτίμηση,\nΗ ομάδα της ITDev',
 'name, company, owner_name', true),

('won_next_steps',
 'What-happens-next email after Won',
 'Τα επόμενα βήματα της συνεργασίας μας',
 E'Γεια σας {{name}},\n\nΓια να ξεκινήσουμε άμεσα:\n\n1. Το λογιστήριό μας θα σας στείλει σύντομα το παραστατικό πληρωμής.\n2. Μόλις ολοκληρωθεί η πληρωμή, η τεχνική μας ομάδα ξεκινά αμέσως.\n3. Θα λάβετε μια σύντομη φόρμα με τα στοιχεία που χρειαζόμαστε (πρόσβαση, υλικό, στόχοι).\n\nΟποιαδήποτε απορία, απαντήστε σε αυτό το email.\n\nΜε εκτίμηση,\nΗ ομάδα της ITDev',
 'name, company, owner_name', true),

('reengage_90d',
 'Re-engagement for Not Interested / Dead End after 90 days (off by default)',
 'Άλλαξε κάτι, {{name}};',
 E'Γεια σας {{name}},\n\nΠριν λίγους μήνες είχαμε συζητήσει για την online παρουσία της {{company}}. Αν κάτι έχει αλλάξει και θέλετε να το ξαναδούμε, είμαστε εδώ.\n\nΜε εκτίμηση,\nΗ ομάδα της ITDev',
 'name, company, owner_name', true),

-- Existing built-ins become editable too (texts match the edge function).
('payment_due_soon',
 'Payment reminder — 3 days before the due date',
 'Υπενθύμιση πληρωμής — λήγει {{due_date}}',
 E'Αγαπητέ/ή {{client_name}},\n\nΣας υπενθυμίζουμε ότι η πληρωμή για την υπηρεσία {{service_type}} ποσού {{amount_gross}}€ λήγει στις {{due_date}}.\n\nΜε εκτίμηση,\nITDev Λογιστήριο',
 'client_name, service_type, amount_gross, due_date', true),
('payment_due_today',
 'Payment reminder — on the due date',
 'Η πληρωμή σας λήγει σήμερα',
 E'Αγαπητέ/ή {{client_name}},\n\nΗ πληρωμή για την υπηρεσία {{service_type}} ποσού {{amount_gross}}€ λήγει σήμερα {{due_date}}.\n\nΜε εκτίμηση,\nITDev Λογιστήριο',
 'client_name, service_type, amount_gross, due_date', true),
('payment_overdue',
 'Payment reminder — the day after the due date',
 'Εκπρόθεσμη πληρωμή',
 E'Αγαπητέ/ή {{client_name}},\n\nΗ πληρωμή για την υπηρεσία {{service_type}} ποσού {{amount_gross}}€ έληξε στις {{due_date}}. Παρακαλούμε επικοινωνήστε με το λογιστήριο: accounting@itdev.gr.\n\nΜε εκτίμηση,\nITDev Λογιστήριο',
 'client_name, service_type, amount_gross, due_date', true);

-- ---------------------------------------------------------------------------
-- Seeds: settings.
-- ---------------------------------------------------------------------------
insert into public.email_automation_settings (key, description, enabled) values
('global',               'Master switch for ALL automated lead emails', true),
('lead_welcome',         'Welcome email on new lead (Meta + manual sources only)', true),
('won_welcome',          'Automatic welcome email when a lead is Won', true),
('won_next_steps',       'What-happens-next email when a lead is Won', true),
('scheduled_confirm',    'Confirmation email when a call is booked', true),
('scheduled_reminder',   'Reminder email the day before a booked call', true),
('scheduled_noshow',     'Follow-up email the day after a missed call', true),
('auto_move_constant_na','Auto-move lead to Constant NA when the No Answer cadence ends', true),
('constant_na_suggest',  'Suggest Dead End to the owner after 30 days in Constant NA', true);

-- ---------------------------------------------------------------------------
-- Seeds: sequences + steps (day offsets editable in the admin UI).
-- ---------------------------------------------------------------------------
insert into public.email_sequences (key, display_name, description, active_stage_codes, enabled) values
('no_answer',  'No Answer cadence',  'Runs while the lead sits in No Answer; stops on any stage change, reply handling, or unsubscribe.', array['no_answer'], true),
('offer_sent', 'Offer follow-ups',   'Runs while the lead sits in Offer Sent.', array['offer_sent'], true),
('reengage',   'Re-engagement',      '90-day "has anything changed?" for Not Interested / Dead End leads.', array['not_interested','dead_end'], false);

insert into public.email_sequence_steps (sequence_id, position, day_offset, template_key)
select s.id, v.position, v.day_offset, v.template_key
from public.email_sequences s
join (values
  ('no_answer', 1, 0,  'noanswer_day0'),
  ('no_answer', 2, 2,  'noanswer_day2'),
  ('no_answer', 3, 5,  'noanswer_day5'),
  ('no_answer', 4, 10, 'noanswer_day10'),
  ('offer_sent', 1, 2,  'offer_followup_day2'),
  ('offer_sent', 2, 5,  'offer_followup_day5'),
  ('offer_sent', 3, 10, 'offer_followup_day10'),
  ('reengage',   1, 90, 'reengage_90d')
) as v(seq_key, position, day_offset, template_key)
  on v.seq_key = s.key;
