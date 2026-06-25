-- 20260625100000_activity_log_client_id.sql
-- Add a client_id column to activity_log so a single indexed query can fetch
-- every event for a client. Nullable: events not tied to a client (e.g. some
-- leads/comments) keep it null. ON DELETE SET NULL so client deletion never
-- blocks on the log.

alter table public.activity_log
  add column if not exists client_id uuid
  references public.clients(id) on delete set null;

create index if not exists activity_log_client_created_idx
  on public.activity_log (client_id, created_at desc)
  where client_id is not null;

-- ROLLBACK:
--   drop index if exists public.activity_log_client_created_idx;
--   alter table public.activity_log drop column if exists client_id;
