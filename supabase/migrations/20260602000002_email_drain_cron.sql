create extension if not exists pg_net with schema extensions;

-- Drain the email outbox every 2 minutes by pulsing the send-email Edge Function.
-- Reads project_url + service_role_key from Vault (set manually, see go-live checklist).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'drain_email_outbox') then
    perform cron.unschedule('drain_email_outbox');
  end if;
  perform cron.schedule(
    'drain_email_outbox',
    '*/2 * * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := jsonb_build_object('drain', true)
      );
    $cron$
  );
end $$;

-- ROLLBACK:
-- do $$ begin
--   if exists (select 1 from cron.job where jobname = 'drain_email_outbox') then
--     perform cron.unschedule('drain_email_outbox');
--   end if;
-- end $$;
