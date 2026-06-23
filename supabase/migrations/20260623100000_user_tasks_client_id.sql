-- Personal tasks can optionally focus a client (delegated assigned_tasks already
-- carry client_id, filled from their deal/job). Nullable; on client delete the
-- task survives unlinked.
alter table public.user_tasks
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists user_tasks_client_id
  on public.user_tasks (client_id) where client_id is not null;

-- ROLLBACK (manual):
--   drop index if exists public.user_tasks_client_id;
--   alter table public.user_tasks drop column if exists client_id;
