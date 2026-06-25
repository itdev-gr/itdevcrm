-- Instant-send pulse (Build B, step 3).
--
-- Fire a drain the instant a row is enqueued instead of waiting up to 2 minutes
-- for the cron. pg_net's http_post is async (it enqueues the request and returns
-- immediately), so this does NOT block the enqueueing transaction (e.g. a deal
-- stage change). The 2-minute cron stays as a backstop + retry, and the drain is
-- concurrency-safe via claim_email_outbox() (migration 20260625150000).
--
-- Paused automations are unaffected: they are never enqueued, so they never pulse.
--
-- Changes / Revert: revert SQL at the bottom (commented).

create or replace function public.email_outbox_pulse()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Best-effort: if the pulse fails for any reason, the row is already enqueued
  -- and the 2-minute cron will still drain it — never let a pulse error roll back
  -- the caller's transaction.
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_drain_secret')
      ),
      body := jsonb_build_object('drain', true)
    );
  exception when others then
    null;
  end;
  return null;
end $function$;

-- Statement-level: one pulse per insert statement (a drain handles up to 50 rows;
-- any overflow from a big bulk insert is picked up by the cron backstop).
drop trigger if exists email_outbox_pulse on public.email_outbox;
create trigger email_outbox_pulse
after insert on public.email_outbox
for each statement
execute function public.email_outbox_pulse();

-- ============================================================================
-- REVERT:
--   drop trigger if exists email_outbox_pulse on public.email_outbox;
--   drop function if exists public.email_outbox_pulse();
--   -- (emails then fall back to the existing 2-minute cron drain)
-- ============================================================================
