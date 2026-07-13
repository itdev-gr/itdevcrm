-- 2026-07-13: owner-requested — sweep client email every 2 minutes (was 5).
-- Pairs with the gmail-sync starvation fix (incremental boxes first, 90s
-- budget), so runs finish inside the cadence.
--
-- ROLLBACK:
--   select cron.alter_job(
--     (select jobid from cron.job where jobname = 'gmail_sync_sweep'),
--     schedule => '*/5 * * * *');

select cron.alter_job(
  (select jobid from cron.job where jobname = 'gmail_sync_sweep'),
  schedule => '*/2 * * * *');
