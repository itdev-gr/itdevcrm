-- =============================================================================
-- 2026-08-17: weekly Web Dev status report → department lead.
--
-- Every Monday 05:00 UTC (08:00 Athens in summer, 07:00 in winter) pg_cron
-- POSTs {run:true} to the webdev-weekly-report edge function. The function
-- computes the week's facts from jobs/activity_log/assigned_tasks, asks OpenAI
-- for the narrative, and enqueues ONE email_outbox row (identity 'internal',
-- template 'webdev_weekly_report') for WEBDEV_REPORT_TO — currently
-- mkifokeris@itdev.gr only, per owner decision 2026-08-17. The existing */2min
-- drain_email_outbox cron delivers it. Idempotency: dedupe_key
-- 'webdev_weekly:<ISO week>' means a cron retry can never double-send.
--
-- DEPLOY-TIME PREREQUISITES (manual, like gmail_sync_secret):
--   1. select vault.create_secret('<random>', 'webdev_report_secret');
--   2. Edge function secrets: WEBDEV_REPORT_SECRET=<same random>,
--      (optional) WEBDEV_REPORT_TO to widen/redirect the recipient.
--   3. Deploy functions: webdev-weekly-report (verify_jwt=false) and the
--      updated send-email (new webdev_weekly_report template).
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'webdev_weekly_report') then
    perform cron.unschedule('webdev_weekly_report');
  end if;
  perform cron.schedule(
    'webdev_weekly_report',
    '0 5 * * 1',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/webdev-weekly-report',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'webdev_report_secret')
        ),
        body := jsonb_build_object('run', true)
      );
    $cron$
  );
end $$;

-- ROLLBACK:
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'webdev_weekly_report') then
--       perform cron.unschedule('webdev_weekly_report');
--     end if;
--   end $$;
