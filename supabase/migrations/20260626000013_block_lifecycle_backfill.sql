-- Payment-driven block lifecycle (4/4): one-time clean-up. Back up first (deal stages,
-- job block state, client statuses), then place every non-terminal deal in the correct
-- stage by DUE date and sync job blocks. p_allow_release=true also corrects over-held deals.
-- Reads payment dates only — never modifies any start_date/end_date.

create table if not exists public.block_lifecycle_backup_20260626 as
  select d.id as deal_id, d.accounting_stage_id, d.client_id, now() as backed_up_at
    from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where not d.archived and ps.code not in ('done','closed');

create table if not exists public.block_lifecycle_jobs_backup_20260626 as
  select id as job_id, deal_id, stage_id, is_blocked, blocked_reason, blocked_at, blocked_by, now() as backed_up_at
    from public.jobs where not archived;

create table if not exists public.block_lifecycle_clients_backup_20260626 as
  select id as client_id, status, now() as backed_up_at from public.clients;

select public.reconcile_block_lifecycle(true);

-- ROLLBACK:
--   update deals d set accounting_stage_id = b.accounting_stage_id
--     from block_lifecycle_backup_20260626 b where d.id = b.deal_id;
--   update jobs j set is_blocked=b.is_blocked, blocked_reason=b.blocked_reason, blocked_at=b.blocked_at,
--          blocked_by=b.blocked_by, stage_id=b.stage_id
--     from block_lifecycle_jobs_backup_20260626 b where j.id = b.job_id;
--   update clients c set status=b.status from block_lifecycle_clients_backup_20260626 b where c.id=b.client_id;
