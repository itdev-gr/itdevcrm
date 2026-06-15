-- Per-service job Info tab: a JSONB bag of service-specific fields on each job.
alter table public.jobs add column details jsonb not null default '{}'::jsonb;

-- Replaced by the Info tab: stop the monthly checklist regenerating for these services.
update public.service_monthly_task_templates
   set tasks = '[]'::jsonb, updated_at = now()
 where service_type in ('local_seo', 'web_seo', 'ai_seo');

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   alter table public.jobs drop column if exists details;
--   -- restore the three templates by re-running their rows from
--   -- supabase/migrations/20260509000001_monthly_task_templates.sql
-- ---------------------------------------------------------------------------
