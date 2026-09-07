-- =============================================================================
-- 20260907290000_campaign_cron_uses_drain_secret.sql
-- Repoint the campaign drain cron at a dedicated `campaign_drain_secret` held
-- in Vault, mirroring what 20260615000004 did for the transactional drain.
--
-- Why: 20260907220000 built the cron from the ORIGINAL 20260602000002 pattern,
-- which posts the Vault `service_role_key`. That pattern was superseded in June
-- — send-campaign compares the bearer token against its own
-- SUPABASE_SERVICE_ROLE_KEY / CAMPAIGN_DRAIN_SECRET env vars, and the Vault
-- `service_role_key` entry no longer matches either, so every pulse returned
-- 403 and the drain never ran. Verified live: the heartbeat sat unchanged for
-- six hours while the cron fired every minute.
--
-- The Vault value `campaign_drain_secret` must equal the CAMPAIGN_DRAIN_SECRET
-- env var set on the send-campaign function. Both are written together by the
-- deploy script; neither is stored in this repo.
-- =============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'drain_campaign_sends') then
    perform cron.unschedule('drain_campaign_sends');
  end if;
  perform cron.schedule(
    'drain_campaign_sends',
    '* * * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/send-campaign',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'campaign_drain_secret')
        ),
        body := jsonb_build_object('drain', true)
      );
    $cron$
  );
end $$;

-- ROLLBACK: re-run the cron block from 20260907220000 (service_role_key variant),
-- accepting that the drain will 403 until the secrets are realigned.
