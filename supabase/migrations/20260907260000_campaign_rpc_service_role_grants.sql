-- =============================================================================
-- 20260907260000_campaign_rpc_service_role_grants.sql
-- Final-review fixes (.superpowers/sdd/2026-09-07-campaign-sending-engine/
-- final-review.md), C-1, C-2 and I-3. Does not edit 20260907220000 —
-- everything in this branch may already have been applied, so this migration
-- is written as if it must layer safely on top of it.
-- =============================================================================

-- --- C-1: service_role grants for the two RPCs send-campaign actually calls --
-- send-email/identities.ts's "every backend-called RPC needs an explicit
-- service_role grant" lesson (20260907230000_suppress_email_service_role_grant.sql)
-- was applied to suppress_email but missed the two sibling functions created
-- in the same migration (20260907220000) that send-campaign/index.ts also
-- calls through the service-role client (admin.rpc(...), index.ts:433, :440):
-- claim_campaign_recipients and campaign_daily_budget. 20260701231000 already
-- revoked the default PUBLIC EXECUTE grant, so without this both calls return
-- permission-denied, the budget resolves to 0, and nothing ever sends while
-- the heartbeat reports the misleading 'no_budget'.
--
-- Audited every other function in 20260907220000 against every
-- `admin.rpc(...)` call in supabase/functions/send-campaign/index.ts (there
-- are exactly two — grep "\.rpc(" — the two granted below). The rest:
--   - recover_stale_campaign_claims: called directly as SQL from the
--     'recover_campaign_claims' pg_cron job (20260907220000:403-413), which
--     runs as the job owner (postgres), not through the edge function or the
--     service-role client. No grant needed.
--   - campaign_launch / campaign_pause / campaign_resume / campaign_cancel /
--     campaign_stats: admin-lifecycle RPCs invoked by a human from the app as
--     an authenticated user, already correctly granted to `authenticated`
--     only (20260907220000:216-217, :249-250, :284-285, :319-320, :371-372).
--     Deliberately NOT granted to service_role here — that would let the
--     drain/cron path launch, pause, resume or cancel a campaign, which is
--     never what it does and must never be able to do.
grant execute on function public.claim_campaign_recipients(uuid, int) to service_role;
grant execute on function public.campaign_daily_budget(uuid) to service_role;

-- --- C-2: claim_campaign_recipients must re-check suppression at send time ---
-- build_campaign_recipients only enforces email_suppressions/unsubscribed_at
-- once, at build time, while the campaign is still 'draft'
-- (20260907210000:126). A campaign prepared before someone unsubscribes (or
-- was hard-bounced/complained by the webhook) but launched after keeps
-- mailing them — claim_campaign_recipients never re-checked either signal.
-- Recreated here with the identical shape (same signature, same
-- `for update skip locked`, the same `attempts < 3` ceiling, the same
-- `ec.status = 'sending'` guard, same return type) plus a re-check that
-- diverts a newly-suppressed/unsubscribed row to status='suppressed',
-- suppression_reason='suppressed_list' (already in the CHECK constraint,
-- 20260907200000:83-84) instead of claiming it — so the row is never
-- silently skipped forever and the campaign can still reach completion
-- (maybeCompleteCampaign only waits on 'pending'/'sending', send-campaign/
-- index.ts:325-347 — unaffected by rows leaving via 'suppressed').
--
-- Implemented as one statement: a `for update skip locked` CTE picks the
-- same candidate rows as before; a first writable CTE flips the
-- newly-suppressed/unsubscribed ones to 'suppressed' and returns their ids;
-- the final UPDATE claims everyone else in the candidate set. Because the
-- final UPDATE's WHERE clause reads from both CTEs, Postgres evaluates them
-- in dependency order, so a row is never both marked 'suppressed' and
-- claimed 'sending' in the same call.
create or replace function public.claim_campaign_recipients(p_campaign_id uuid, p_limit int default 100)
returns setof public.email_campaign_recipients
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select er.id
      from public.email_campaign_recipients er
      join public.email_campaigns ec on ec.id = er.campaign_id
     where er.campaign_id = p_campaign_id
       and er.status = 'pending'
       and er.attempts < 3
       and ec.status = 'sending'
     order by er.queued_at
     limit greatest(p_limit, 0)
     for update skip locked
  ),
  newly_suppressed as (
    update public.email_campaign_recipients r
       set status = 'suppressed', suppression_reason = 'suppressed_list'
      from candidates c
     where r.id = c.id
       and (
         r.unsubscribed_at is not null
         or exists (
           select 1 from public.email_suppressions es where es.email_lower = r.email_lower
         )
       )
    returning r.id
  )
  update public.email_campaign_recipients r
     set status = 'sending', claimed_at = now(), attempts = r.attempts + 1
   where r.id in (select id from candidates)
     and r.id not in (select id from newly_suppressed)
  returning r.*;
$$;

revoke all on function public.claim_campaign_recipients(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_campaign_recipients(uuid, int) to service_role;

-- --- I-3: an RPC to release claimed-but-never-POSTed rows without burning ----
-- ------- an attempt --------------------------------------------------------
-- claim_campaign_recipients (above) increments `attempts` on every row it
-- claims. send-campaign/index.ts releases rows back to 'pending' in two
-- situations that are NOT a real send attempt: the untried tail after a 429
-- on an earlier chunk, and rows abandoned because the invocation lost its
-- drain lock lease before it ever built a Resend request for them. Without
-- this, three transient 429s (a realistic burst on a shared 10 req/s Resend
-- account) can exhaust attempts<3 on people who were never contacted,
-- failExhaustedRecipients marks them 'failed', and maybeCompleteCampaign
-- reports the campaign 'sent' with those recipients silently dropped.
--
-- A plain `.update({...})` via postgrest-js cannot express
-- `attempts = attempts - 1` (no server-side arithmetic in that client), so
-- this is a dedicated RPC. Deliberately separate from releaseChunk's plain
-- update (index.ts) — that path is for rows that WERE posted (or a POST was
-- actually attempted) and failed, which keep their attempts increment as a
-- real attempt; this RPC must never be called for those.
create or replace function public.release_unattempted_campaign_recipients(p_ids uuid[], p_error text default null)
returns int
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.email_campaign_recipients
       set status = 'pending',
           claimed_at = null,
           attempts = greatest(attempts - 1, 0),
           error = left(coalesce(p_error, ''), 2000)
     where id = any(p_ids)
    returning 1
  )
  select count(*)::int from updated;
$$;

revoke all on function public.release_unattempted_campaign_recipients(uuid[], text) from public, anon, authenticated;
grant execute on function public.release_unattempted_campaign_recipients(uuid[], text) to service_role;

-- ============================================================================
-- ROLLBACK (run manually to roll back this migration):
--   revoke execute on function public.release_unattempted_campaign_recipients(uuid[], text) from service_role;
--   drop function if exists public.release_unattempted_campaign_recipients(uuid[], text);
--   -- restores claim_campaign_recipients to its pre-C-2 shape (no suppression
--   -- re-check) exactly as it stood after 20260907220000:
--   create or replace function public.claim_campaign_recipients(p_campaign_id uuid, p_limit int default 100)
--   returns setof public.email_campaign_recipients
--   language sql security definer set search_path = public as $$
--     update public.email_campaign_recipients r
--        set status = 'sending', claimed_at = now(), attempts = r.attempts + 1
--      where r.id in (
--        select er.id
--          from public.email_campaign_recipients er
--          join public.email_campaigns ec on ec.id = er.campaign_id
--         where er.campaign_id = p_campaign_id
--           and er.status = 'pending'
--           and er.attempts < 3
--           and ec.status = 'sending'
--         order by er.queued_at
--         limit greatest(p_limit, 0)
--         for update skip locked
--      )
--     returning r.*;
--   $$;
--   revoke all on function public.claim_campaign_recipients(uuid, int) from public, anon, authenticated, service_role;
--   revoke execute on function public.campaign_daily_budget(uuid) from service_role;
-- ============================================================================
