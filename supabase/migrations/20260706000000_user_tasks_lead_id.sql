-- =============================================================================
-- user_tasks: optional link to a lead (sales work leads, not clients).
-- Mirrors 20260623100000_user_tasks_client_id.sql. A task links to either a
-- client or a lead (UI sets one); on lead delete the task survives unlinked.
-- No RLS change: column inherits user_tasks policies.
--
-- ROLLBACK (manual):
--   drop index if exists public.user_tasks_lead_id;
--   alter table public.user_tasks drop column if exists lead_id;
-- =============================================================================
alter table public.user_tasks
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

create index if not exists user_tasks_lead_id
  on public.user_tasks (lead_id) where lead_id is not null;
