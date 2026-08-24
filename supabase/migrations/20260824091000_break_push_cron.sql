-- =============================================================================
-- 2026-08-24: nightly push of per-user break totals to the sales app.
--
-- 22:30 UTC (01:30 Athens summer / 00:30 winter — always the NEXT Athens day,
-- after close_dangling_breaks has run) pg_cron POSTs {} to the
-- push-break-stats edge function, which aggregates yesterday's (Athens)
-- break_sessions per user and upserts them into the sales app's
-- daily_activity via its upsert_break_activity RPC, matching people by email.
--
-- DEPLOY-TIME PREREQUISITES (manual, like webdev_report_secret):
--   1. select vault.create_secret('<random>', 'break_push_secret');
--   2. Edge function secrets: BREAK_PUSH_SECRET=<same random>,
--      SALES_SUPABASE_URL, SALES_SERVICE_ROLE_KEY.
--   3. Deploy function: push-break-stats (verify_jwt=false).
--
-- No function redefinitions in this migration, so no pg_get_functiondef md5
-- pre/post capture is required.
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'push_break_stats') then
    perform cron.unschedule('push_break_stats');
  end if;
  perform cron.schedule(
    'push_break_stats',
    '30 22 * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push-break-stats',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'break_push_secret')
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
end $$;

-- ROLLBACK:
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'push_break_stats') then
--       perform cron.unschedule('push_break_stats');
--     end if;
--   end $$;
