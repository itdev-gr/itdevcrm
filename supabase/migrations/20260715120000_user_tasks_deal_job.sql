-- user_tasks: optional deal/job target (keeps the task a calendar user_task).
-- Untargeted tasks (both null) stay client-level and surface on all the client's
-- deals/jobs; a deal_id/job_id scopes the task to that deal/job.
alter table public.user_tasks
  add column if not exists deal_id uuid references public.deals(id) on delete set null,
  add column if not exists job_id  uuid references public.jobs(id)  on delete set null;

create index if not exists user_tasks_deal_id on public.user_tasks (deal_id) where deal_id is not null;
create index if not exists user_tasks_job_id  on public.user_tasks (job_id)  where job_id  is not null;

-- Rollback:
-- drop index if exists user_tasks_job_id;
-- drop index if exists user_tasks_deal_id;
-- alter table public.user_tasks drop column if exists job_id, drop column if exists deal_id;
