-- Register a sibling daily job for ensure_recurring_expenses, leaving the
-- existing daily_ensure_recurring_payments cron untouched. Cron entries
-- include a NOT EXISTS guard so re-running the migration is idempotent.

select cron.schedule(
  'daily_ensure_recurring_expenses',
  '5 2 * * *',
  $$ select public.ensure_recurring_expenses(); $$
)
where not exists (
  select 1 from cron.job where jobname = 'daily_ensure_recurring_expenses'
);

-- ROLLBACK:
-- select cron.unschedule('daily_ensure_recurring_expenses')
--   where exists (select 1 from cron.job where jobname = 'daily_ensure_recurring_expenses');
