-- =============================================================================
-- Remove 4 stages from the Web SEO kanban (per user request 2026-06-30):
--   performance_audit  -> "Έλεγχος Απόδοσης"
--   technical_crawl    -> "Τεχνικός Έλεγχος"
--   internal_links     -> "Εσωτ. Σύνδεσμοι"
--   backlink_cleanup   -> "Καθαρισμός Backlinks"
--
-- Same non-destructive pattern as 20260615000002_web_seo_kanban_clickup_stages:
-- remap any jobs (web_seo AND ai_seo — ai_seo jobs live on web_seo stages) off
-- the removed stages onto the next surviving stage, then ARCHIVE the columns
-- (off the board, FK + history intact). DO NOT DELETE.
--
-- Remap targets (forward to the next stage that stays):
--   performance_audit (60)  -> keyword_research (80)
--   technical_crawl   (70)  -> keyword_research (80)
--   internal_links    (110) -> blogs (130)
--   backlink_cleanup  (120) -> blogs (130)
-- =============================================================================

-- 1. Remap any existing jobs (web_seo AND ai_seo) off the stages being removed.
with old_stage as (
  select code, id from public.pipeline_stages where board = 'web_seo'
),
new_stage as (
  select code, id from public.pipeline_stages where board = 'web_seo'
),
remap(old_code, new_code) as (
  values
    ('performance_audit', 'keyword_research'),
    ('technical_crawl',   'keyword_research'),
    ('internal_links',    'blogs'),
    ('backlink_cleanup',  'blogs')
)
update public.jobs j
   set stage_id = ns.id
  from remap r
  join old_stage os on os.code = r.old_code
  join new_stage ns on ns.code = r.new_code
 where j.stage_id = os.id;

-- 2. Archive the removed columns (off the board, FK + history intact).
update public.pipeline_stages
   set archived = true
 where board = 'web_seo'
   and code in ('performance_audit', 'technical_crawl', 'internal_links', 'backlink_cleanup');

-- ---------------------------------------------------------------------------
-- ROLLBACK (restore the 4 stages to the board; per-job pre-migration stage is
-- not recorded so the job remap reversal is best-effort):
--   update public.pipeline_stages set archived = false where board='web_seo'
--     and code in ('performance_audit','technical_crawl','internal_links','backlink_cleanup');
-- ---------------------------------------------------------------------------
