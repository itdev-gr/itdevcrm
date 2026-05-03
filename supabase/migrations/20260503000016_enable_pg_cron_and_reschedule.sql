-- =============================================================================
-- pg_cron wasn't enabled on the remote project when migrations 14 and 15 ran,
-- so the schedule blocks (guarded with `if exists pg_extension where extname='pg_cron'`)
-- silently skipped. This migration enables the extension and re-schedules both
-- jobs idempotently.
-- =============================================================================

create extension if not exists pg_cron with schema extensions;

-- (Re)schedule the production daily job at 02:00 UTC
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily_ensure_recurring_payments') then
    perform cron.unschedule('daily_ensure_recurring_payments');
  end if;
  perform cron.schedule(
    'daily_ensure_recurring_payments',
    '0 2 * * *',
    $cron$ select public.ensure_recurring_payments(); $cron$
  );
end $$;

-- (Re)schedule the temporary every-minute test job
do $$
begin
  if exists (select 1 from cron.job where jobname = 'every_minute_ensure_recurring_payments') then
    perform cron.unschedule('every_minute_ensure_recurring_payments');
  end if;
  perform cron.schedule(
    'every_minute_ensure_recurring_payments',
    '* * * * *',
    $cron$ select public.ensure_recurring_payments(); $cron$
  );
end $$;
