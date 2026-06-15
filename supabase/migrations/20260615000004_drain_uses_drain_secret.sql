-- =============================================================================
-- Repoint the drain cron at a dedicated random `email_drain_secret` so the
-- outbox drain no longer depends on Supabase JWT keys (rotation/migration safe).
-- Paired with: send-email verify_jwt=false + function env EMAIL_DRAIN_SECRET set
-- to the same value held in vault as `email_drain_secret`.
-- =============================================================================

select cron.unschedule('drain_email_outbox');
select cron.schedule('drain_email_outbox', '*/2 * * * *', $cmd$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_drain_secret')
    ),
    body := jsonb_build_object('drain', true)
  );
$cmd$);

-- ---------------------------------------------------------------------------
-- ROLLBACK (restore the service_role_key-based drain):
--   select cron.unschedule('drain_email_outbox');
--   select cron.schedule('drain_email_outbox', '*/2 * * * *', $cmd$
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-email',
--       headers := jsonb_build_object('Content-Type','application/json',
--         'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
--       body := jsonb_build_object('drain', true));
--   $cmd$);
-- ---------------------------------------------------------------------------
