-- ClickUp migration support: store the source ClickUp task id (+ raw snapshot) on
-- imported clients/deals, for idempotency (skip already-imported on re-run) and to
-- map attachments back to the right deal. Nullable, app-invisible.
alter table public.clients add column if not exists source_data jsonb;
alter table public.deals add column if not exists source_data jsonb;

create index if not exists deals_clickup_task_id_idx
  on public.deals ((source_data->>'clickup_task_id'));

-- ROLLBACK:
-- drop index if exists deals_clickup_task_id_idx;
-- alter table public.deals drop column if exists source_data;
-- alter table public.clients drop column if exists source_data;
