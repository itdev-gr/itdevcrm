-- 20260624010000_jobs_parent_job_id.sql
-- Link AI SEO work cards (web_seo/local_seo children) back to the AI SEO billing
-- record (parent). on delete cascade => children never outlive their billing job.
alter table public.jobs
  add column if not exists parent_job_id uuid references public.jobs(id) on delete cascade;

create index if not exists jobs_parent_job_id_idx on public.jobs (parent_job_id);

-- ROLLBACK:
--   drop index if exists public.jobs_parent_job_id_idx;
--   alter table public.jobs drop column if exists parent_job_id;
