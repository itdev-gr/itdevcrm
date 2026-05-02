-- =============================================================================
-- Phase 2 migration: pipeline_stages (configurable kanban columns)
-- =============================================================================

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  board text not null,
  code text not null,
  display_names jsonb not null,
  position int not null default 0,
  color text,
  is_terminal boolean not null default false,
  terminal_outcome text check (terminal_outcome in ('won', 'lost', 'paid', 'completed', 'cancelled')),
  triggers_action text check (triggers_action in ('lock_deal', 'complete_accounting')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board, code)
);

create index pipeline_stages_board on public.pipeline_stages (board) where archived = false;

create trigger pipeline_stages_set_updated_at
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

alter table public.pipeline_stages enable row level security;

create policy pipeline_stages_select_authenticated
  on public.pipeline_stages for select
  to authenticated
  using (archived = false or public.current_user_is_admin());

create policy pipeline_stages_mutate_admin
  on public.pipeline_stages for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- -----------------------------------------------------------------------------
-- Seeded stages
-- -----------------------------------------------------------------------------
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action) values
-- Sales board (10 stages)
('sales', 'new_lead',       '{"en": "New Lead",       "el": "Νέος Πελάτης"}'::jsonb,        10, false, null, null),
('sales', 'no_answer',      '{"en": "No Answer",      "el": "Δεν Απαντά"}'::jsonb,           20, false, null, null),
('sales', 'constant_na',    '{"en": "Constant NA",    "el": "Σταθερά Δεν Απαντά"}'::jsonb,   30, false, null, null),
('sales', 'working_on_it',  '{"en": "Working On It",  "el": "Σε Εξέλιξη"}'::jsonb,           40, false, null, null),
('sales', 'offer_sent',     '{"en": "Offer Sent",     "el": "Προσφορά Στάλθηκε"}'::jsonb,    50, false, null, null),
('sales', 'scheduled',      '{"en": "Scheduled",      "el": "Προγραμματισμένο"}'::jsonb,     60, false, null, null),
('sales', 'hot',            '{"en": "Hot",            "el": "Καυτό"}'::jsonb,                70, false, null, null),
('sales', 'won',            '{"en": "Won",            "el": "Κερδισμένο"}'::jsonb,           80, true,  'won',     'lock_deal'),
('sales', 'not_interested', '{"en": "Not Interested", "el": "Μη Ενδιαφέρον"}'::jsonb,        90, true,  'lost',    null),
('sales', 'dead_end',       '{"en": "Dead End",       "el": "Αδιέξοδο"}'::jsonb,            100, true,  'lost',    null),

-- Accounting onboarding board
('accounting_onboarding', 'new',                '{"en": "New",                "el": "Νέο"}'::jsonb,                  10, false, null, null),
('accounting_onboarding', 'documents_verified', '{"en": "Documents Verified", "el": "Έγγραφα Επιβεβαιωμένα"}'::jsonb, 20, false, null, null),
('accounting_onboarding', 'invoice_issued',     '{"en": "Invoice Issued",     "el": "Τιμολόγιο Εκδόθηκε"}'::jsonb,    30, false, null, null),
('accounting_onboarding', 'awaiting_payment',   '{"en": "Awaiting Payment",   "el": "Αναμονή Πληρωμής"}'::jsonb,      40, false, null, null),
('accounting_onboarding', 'partial_payment',    '{"en": "Partial Payment",    "el": "Μερική Πληρωμή"}'::jsonb,        50, false, null, null),
('accounting_onboarding', 'paid_in_full',       '{"en": "Paid In Full",       "el": "Πλήρως Εξοφλημένο"}'::jsonb,     60, true,  'paid',      'complete_accounting'),
('accounting_onboarding', 'on_hold',            '{"en": "On Hold",            "el": "Σε Αναμονή"}'::jsonb,           70, false, null, null),
('accounting_onboarding', 'refunded',           '{"en": "Refunded",           "el": "Επιστροφή Χρημάτων"}'::jsonb,    80, true,  'cancelled', null),

-- Web SEO (recurring)
('web_seo', 'onboarding',     '{"en": "Onboarding",     "el": "Ενσωμάτωση"}'::jsonb,         10, false, null, null),
('web_seo', 'audit_strategy', '{"en": "Audit & Strategy","el": "Έλεγχος & Στρατηγική"}'::jsonb, 20, false, null, null),
('web_seo', 'active',         '{"en": "Active",         "el": "Ενεργό"}'::jsonb,             30, false, null, null),
('web_seo', 'on_hold',        '{"en": "On Hold",        "el": "Σε Αναμονή"}'::jsonb,         40, false, null, null),
('web_seo', 'cancelled',      '{"en": "Cancelled",      "el": "Ακυρωμένο"}'::jsonb,          50, true,  'cancelled', null),

-- Local SEO (recurring)
('local_seo', 'onboarding',    '{"en": "Onboarding",    "el": "Ενσωμάτωση"}'::jsonb,        10, false, null, null),
('local_seo', 'gbp_setup',     '{"en": "GBP Setup",     "el": "Ρύθμιση Google Business"}'::jsonb, 20, false, null, null),
('local_seo', 'active',        '{"en": "Active",        "el": "Ενεργό"}'::jsonb,             30, false, null, null),
('local_seo', 'on_hold',       '{"en": "On Hold",       "el": "Σε Αναμονή"}'::jsonb,         40, false, null, null),
('local_seo', 'cancelled',     '{"en": "Cancelled",     "el": "Ακυρωμένο"}'::jsonb,          50, true,  'cancelled', null),

-- Social Media (recurring)
('social_media', 'onboarding',         '{"en": "Onboarding",         "el": "Ενσωμάτωση"}'::jsonb,        10, false, null, null),
('social_media', 'content_plan',       '{"en": "Content Plan",       "el": "Πλάνο Περιεχομένου"}'::jsonb, 20, false, null, null),
('social_media', 'active',             '{"en": "Active",             "el": "Ενεργό"}'::jsonb,             30, false, null, null),
('social_media', 'on_hold',            '{"en": "On Hold",            "el": "Σε Αναμονή"}'::jsonb,         40, false, null, null),
('social_media', 'cancelled',          '{"en": "Cancelled",          "el": "Ακυρωμένο"}'::jsonb,          50, true,  'cancelled', null),

-- Web Dev (one-time)
('web_dev', 'awaiting_brief', '{"en": "Awaiting Brief", "el": "Αναμονή Brief"}'::jsonb,        10, false, null, null),
('web_dev', 'discovery',      '{"en": "Discovery",      "el": "Ανακάλυψη"}'::jsonb,             20, false, null, null),
('web_dev', 'wireframes',     '{"en": "Wireframes",     "el": "Wireframes"}'::jsonb,             30, false, null, null),
('web_dev', 'design',         '{"en": "Design",         "el": "Σχεδιασμός"}'::jsonb,            40, false, null, null),
('web_dev', 'development',    '{"en": "Development",    "el": "Ανάπτυξη"}'::jsonb,              50, false, null, null),
('web_dev', 'internal_qa',    '{"en": "Internal QA",    "el": "Εσωτερικός Έλεγχος"}'::jsonb,    60, false, null, null),
('web_dev', 'client_review',  '{"en": "Client Review",  "el": "Έλεγχος Πελάτη"}'::jsonb,        70, false, null, null),
('web_dev', 'revisions',      '{"en": "Revisions",      "el": "Διορθώσεις"}'::jsonb,            80, false, null, null),
('web_dev', 'live',           '{"en": "Live",           "el": "Παραδόθηκε"}'::jsonb,            90, true,  'completed', null),
('web_dev', 'maintenance',    '{"en": "Maintenance",    "el": "Συντήρηση"}'::jsonb,            100, true,  'completed', null);
