-- Concurrency-safe email drain (step 1 of instant-send).
--
-- The instant-send "pulse" (added in a later migration) makes drains run
-- concurrently with the 2-minute cron. The current drain() SELECTs pending rows
-- without locking, so two overlapping drains could grab the same row and send it
-- twice. This migration adds an ATOMIC claim so concurrent drains take disjoint
-- row sets, plus recovery for rows left mid-flight.
--
-- This migration is backward-compatible: nothing calls claim_email_outbox() yet,
-- so the live drain keeps working exactly as before until send-email is redeployed.
--
-- Changes / Revert:
--   Revert SQL is at the bottom of this file (commented).

-- 1) Allow an interim 'sending' status while a row is claimed but not yet sent.
alter table public.email_outbox drop constraint email_outbox_status_check;
alter table public.email_outbox add constraint email_outbox_status_check
  check (status = any (array['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text]));

-- 2) When the row was claimed (used by stale-claim recovery).
alter table public.email_outbox add column if not exists claimed_at timestamptz;

-- 3) Atomically claim up to p_limit pending rows. FOR UPDATE SKIP LOCKED means two
--    concurrent callers never claim the same row; the status flip to 'sending'
--    makes the claim visible across the (pooled) connection the edge fn uses.
create or replace function public.claim_email_outbox(p_limit int default 50)
returns setof public.email_outbox
language sql
security definer
set search_path to 'public'
as $$
  update public.email_outbox o
     set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select id from public.email_outbox
      where status = 'pending' and attempts < 5
      order by created_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning o.*;
$$;

revoke all on function public.claim_email_outbox(int) from public, anon, authenticated;

-- 4) Recover rows stuck in 'sending' (e.g. the function crashed after claiming but
--    before marking sent/failed) back to 'pending' so the next drain retries them.
create or replace function public.recover_stale_email_claims(p_older_than interval default interval '5 minutes')
returns int
language sql
security definer
set search_path to 'public'
as $$
  with reset as (
    update public.email_outbox
       set status = 'pending', claimed_at = null
     where status = 'sending'
       and claimed_at is not null
       and claimed_at < now() - p_older_than
    returning 1
  )
  select count(*)::int from reset;
$$;

revoke all on function public.recover_stale_email_claims(interval) from public, anon, authenticated;

-- 5) Safety-net cron: recover stale claims every 5 minutes, independent of the
--    edge function (so a broken function can't strand rows in 'sending' forever).
select cron.schedule('recover_stale_email_claims', '*/5 * * * *',
  $$ select public.recover_stale_email_claims(); $$);

-- ============================================================================
-- REVERT (run manually to roll back this migration):
--   select cron.unschedule('recover_stale_email_claims');
--   drop function if exists public.recover_stale_email_claims(interval);
--   drop function if exists public.claim_email_outbox(int);
--   update public.email_outbox set status='pending', claimed_at=null where status='sending';
--   alter table public.email_outbox drop column if exists claimed_at;
--   alter table public.email_outbox drop constraint email_outbox_status_check;
--   alter table public.email_outbox add constraint email_outbox_status_check
--     check (status = any (array['pending'::text,'sent'::text,'failed'::text]));
-- ============================================================================
