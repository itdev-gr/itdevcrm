-- 2026-07-10: decouple the gmail-sync cron from the service_role key.
-- The 08:30 UTC key rotation left vault's service_role_key stale => every sweep
-- 403'd (same failure mode email-drain hit once; same fix: dedicated secret).
-- The cron now authenticates with vault secret 'gmail_sync_secret', which must
-- equal the edge function's GMAIL_SYNC_SECRET. Survives future key rotations.
--
-- PRE-REQ (operator, values never in repo):
--   1. supabase secrets set GMAIL_SYNC_SECRET=<value> --project-ref xujlrclyzxrvxszepquy
--   2. select vault.create_secret('<value>', 'gmail_sync_secret');
--      (or vault.update_secret(id, ...) if the name already exists)
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
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gmail_sync_secret')
        ),
        body := jsonb_build_object('mode', 'sweep')
      );
    $cron$
  );
end $$;

-- ROLLBACK: re-apply 20260710090000_gmail_sync_cron.sql (service_role_key
-- variant) after refreshing vault's service_role_key with the current key.
