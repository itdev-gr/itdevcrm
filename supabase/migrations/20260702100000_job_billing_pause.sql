-- =========================================================================
-- 20260702100000_job_billing_pause.sql
-- Per-job (chain-scoped) billing pause for accounting.
--   S1: add 'cancelled' to deal_payments.status CHECK
--   S2: swap UNIQUE partial index to exclude cancelled rows
--   S3: thread status <> 'cancelled' through the 6 state-machine functions
--   S4: job_pause_billing / job_resume_billing RPCs
--   S5 (bottom): revert SQL
-- =========================================================================

-- ---- Section 1: status CHECK gains 'cancelled' ------------------------
alter table public.deal_payments
  drop constraint if exists deal_payments_status_check;
alter table public.deal_payments
  add constraint deal_payments_status_check
  check (status = any (array['pending'::text,'paid'::text,'overdue'::text,'cancelled'::text]));

-- ---- Section 2: UNIQUE index excludes cancelled ------------------------
-- Cancelled rows leave the index, freeing the period-key so resume /
-- manual re-billing of a paused period cannot hit unique_violation.
create unique index if not exists deal_payments_recurring_period_key_unique_v2
  on public.deal_payments (deal_id, service_type, billing_type, start_date, end_date)
  where billing_type in ('recurring_monthly','recurring_yearly')
    and start_date is not null and end_date is not null
    and status <> 'cancelled';
drop index if exists public.deal_payments_recurring_period_key_unique;
