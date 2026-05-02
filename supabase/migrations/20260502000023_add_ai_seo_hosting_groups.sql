-- =============================================================================
-- Add ai_seo + hosting groups, pipeline_stages, expand jobs.service_type check
-- =============================================================================

-- 1. Groups
insert into public.groups (code, display_names, parent_label, position) values
  ('ai_seo',  '{"en": "AI SEO",  "el": "AI SEO"}'::jsonb,    'Technical', 70),
  ('hosting', '{"en": "Hosting", "el": "Φιλοξενία"}'::jsonb, 'Technical', 80)
on conflict (code) do nothing;

-- 2. Pipeline stages — AI SEO (parallel to web_seo)
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action) values
  ('ai_seo', 'onboarding',     '{"en": "Onboarding",     "el": "Ενσωμάτωση"}'::jsonb,         10, false, null, null),
  ('ai_seo', 'audit_strategy', '{"en": "Audit & Strategy","el": "Έλεγχος & Στρατηγική"}'::jsonb, 20, false, null, null),
  ('ai_seo', 'active',         '{"en": "Active",         "el": "Ενεργό"}'::jsonb,             30, false, null, null),
  ('ai_seo', 'on_hold',        '{"en": "On Hold",        "el": "Σε Αναμονή"}'::jsonb,         40, false, null, null),
  ('ai_seo', 'cancelled',      '{"en": "Cancelled",      "el": "Ακυρωμένο"}'::jsonb,          50, true,  'cancelled', null)
on conflict (board, code) do nothing;

-- 3. Pipeline stages — Hosting (simpler: setup → active → cancelled)
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action) values
  ('hosting', 'setup',     '{"en": "Setup",     "el": "Ρύθμιση"}'::jsonb,    10, false, null, null),
  ('hosting', 'active',    '{"en": "Active",    "el": "Ενεργό"}'::jsonb,     20, false, null, null),
  ('hosting', 'on_hold',   '{"en": "On Hold",   "el": "Σε Αναμονή"}'::jsonb, 30, false, null, null),
  ('hosting', 'cancelled', '{"en": "Cancelled", "el": "Ακυρωμένο"}'::jsonb,  40, true,  'cancelled', null)
on conflict (board, code) do nothing;

-- 4. Expand jobs.service_type check constraint
alter table public.jobs drop constraint if exists jobs_service_type_check;
alter table public.jobs add constraint jobs_service_type_check
  check (service_type in ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting'));
