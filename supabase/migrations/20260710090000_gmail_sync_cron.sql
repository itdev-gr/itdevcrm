-- 2026-07-10: schedule the client-email sync every 5 minutes.
-- Mirrors the email-drain cron: net.http_post to the edge function, authed with
-- the service_role_key from vault. gmail-sync's 'sweep' mode syncs every
-- read-scoped user incrementally (currently only mkifokeris until rollout).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gmail_sync_sweep') then
    perform cron.unschedule('gmail_sync_sweep');
  end if;
  perform cron.schedule(
    'gmail_sync_sweep',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/gmail-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := jsonb_build_object('mode', 'sweep')
      );
    $cron$
  );
end $$;

-- ROLLBACK:
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'gmail_sync_sweep') then
--       perform cron.unschedule('gmail_sync_sweep');
--     end if;
--   end $$;
