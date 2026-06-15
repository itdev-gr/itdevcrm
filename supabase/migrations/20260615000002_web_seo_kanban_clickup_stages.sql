-- =============================================================================
-- Re-align the Web Seo kanban columns to the agency's ClickUp pipeline.
--
-- Old web_seo stages: onboarding, audit_strategy, active, on_hold, cancelled.
-- New web_seo stages (this migration): new_project, no_response, renewal,
--   gsc_ga4_setup, sitemap_schema, performance_audit, technical_crawl,
--   keyword_research, metadata, content, internal_links, backlink_cleanup,
--   blogs, results_review, stuck, done (terminal).
--
-- NOTE: AI SEO jobs canonically live on web_seo stages, so the remap below is
-- intentionally NOT filtered by service_type — it moves both web_seo AND ai_seo
-- jobs off the removed stages. The web_seo<->local_seo code mapping for AI SEO
-- display is updated in src/features/jobs/kanbanGrouping.ts in the same change.
--
-- Strategy (non-destructive): insert the new stages, remap existing jobs off the
-- old stages onto the closest new stage, then ARCHIVE the old stages (archived
-- stages drop off the board but keep FK integrity + history).
-- =============================================================================

-- 1. Insert the new columns (idempotent: refresh + un-archive on conflict).
insert into public.pipeline_stages
  (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action)
values
  ('web_seo', 'new_project',       '{"en": "New Project",       "el": "Νέο Έργο"}'::jsonb,             10, false, null,        null),
  ('web_seo', 'no_response',        '{"en": "No Response",       "el": "Χωρίς Απάντηση"}'::jsonb,       20, false, null,        null),
  ('web_seo', 'renewal',           '{"en": "Renewal",           "el": "Ανανέωση"}'::jsonb,             30, false, null,        null),
  ('web_seo', 'gsc_ga4_setup',     '{"en": "GSC & GA4 Setup",   "el": "Ρύθμιση GSC & GA4"}'::jsonb,    40, false, null,        null),
  ('web_seo', 'sitemap_schema',    '{"en": "Sitemap & Schema",  "el": "Sitemap & Schema"}'::jsonb,     50, false, null,        null),
  ('web_seo', 'performance_audit', '{"en": "Performance Audit", "el": "Έλεγχος Απόδοσης"}'::jsonb,      60, false, null,        null),
  ('web_seo', 'technical_crawl',   '{"en": "Technical Crawl",   "el": "Τεχνικός Έλεγχος"}'::jsonb,      70, false, null,        null),
  ('web_seo', 'keyword_research',  '{"en": "Keyword Research",  "el": "Έρευνα Keywords"}'::jsonb,       80, false, null,        null),
  ('web_seo', 'metadata',          '{"en": "Metadata",          "el": "Metadata"}'::jsonb,             90, false, null,        null),
  ('web_seo', 'content',           '{"en": "Content",           "el": "Περιεχόμενο"}'::jsonb,         100, false, null,        null),
  ('web_seo', 'internal_links',    '{"en": "Internal Links",    "el": "Εσωτ. Σύνδεσμοι"}'::jsonb,      110, false, null,        null),
  ('web_seo', 'backlink_cleanup',  '{"en": "Backlink Cleanup",  "el": "Καθαρισμός Backlinks"}'::jsonb, 120, false, null,        null),
  ('web_seo', 'blogs',             '{"en": "Blogs",             "el": "Μπλογκ"}'::jsonb,               130, false, null,        null),
  ('web_seo', 'results_review',    '{"en": "Results Review",    "el": "Έλεγχος Αποτελεσμάτων"}'::jsonb, 140, false, null,        null),
  ('web_seo', 'stuck',             '{"en": "Stuck",             "el": "Κολλημένο"}'::jsonb,            150, false, null,        null),
  ('web_seo', 'done',              '{"en": "Done",              "el": "Ολοκληρώθηκε"}'::jsonb,         160, true,  'completed', null)
on conflict (board, code) do update set
  display_names    = excluded.display_names,
  position         = excluded.position,
  is_terminal      = excluded.is_terminal,
  terminal_outcome = excluded.terminal_outcome,
  triggers_action  = excluded.triggers_action,
  archived         = false;

-- 2. Remap existing jobs (web_seo AND ai_seo) off the removed stages.
with old_stage as (
  select code, id from public.pipeline_stages where board = 'web_seo'
),
new_stage as (
  select code, id from public.pipeline_stages where board = 'web_seo'
),
remap(old_code, new_code) as (
  values
    ('onboarding',     'new_project'),
    ('audit_strategy', 'performance_audit'),
    ('active',         'content'),
    ('on_hold',        'stuck'),
    ('cancelled',      'done')
)
update public.jobs j
   set stage_id = ns.id
  from remap r
  join old_stage os on os.code = r.old_code
  join new_stage ns on ns.code = r.new_code
 where j.stage_id = os.id;

-- 3. Archive the removed columns (off the board, FK + history intact).
update public.pipeline_stages
   set archived = true
 where board = 'web_seo'
   and code in ('onboarding', 'audit_strategy', 'active', 'on_hold', 'cancelled');

-- ---------------------------------------------------------------------------
-- ROLLBACK (restores the original web_seo board; job remap reversal is
-- best-effort — exact pre-migration stage per job is not recorded):
--   update public.pipeline_stages set archived = false where board='web_seo'
--     and code in ('onboarding','audit_strategy','active','on_hold','cancelled');
--   update public.pipeline_stages set archived = true where board='web_seo'
--     and code in ('new_project','no_response','renewal','gsc_ga4_setup','sitemap_schema',
--                  'performance_audit','technical_crawl','keyword_research','metadata',
--                  'content','internal_links','backlink_cleanup','blogs','results_review',
--                  'stuck','done');
--   -- also revert src/features/jobs/kanbanGrouping.ts to the old code mapping.
-- ---------------------------------------------------------------------------
