-- =============================================================================
-- Schedule ensure_recurring_payments() to run daily at 02:00 UTC.
-- Until now the RPC was only invoked from the frontend (kanban mount), which
-- meant recurring deal_payments rows were created only when somebody opened
-- the accounting board. This makes the renewal truly automatic.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Idempotent: drop the existing job if it was scheduled before.
    if exists (select 1 from cron.job where jobname = 'daily_ensure_recurring_payments') then
      perform cron.unschedule('daily_ensure_recurring_payments');
    end if;

    perform cron.schedule(
      'daily_ensure_recurring_payments',
      '0 2 * * *',
      $cron$ select public.ensure_recurring_payments(); $cron$
    );
  end if;
exception when others then
  -- pg_cron unavailable (local dev) — skip.
  null;
end $$;
