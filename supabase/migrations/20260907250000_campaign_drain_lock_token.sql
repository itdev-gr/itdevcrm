-- =============================================================================
-- 20260907250000_campaign_drain_lock_token.sql
-- Re-review fix (fix-2-review.md, New Important-1): the lease added in
-- 20260907240000 had no fencing token, so `releaseDrainLock()` cleared
-- `lock_expires_at` unconditionally. Failure scenario: invocation A's lease
-- expires while A is still mid-send (Resend is slow — exactly the condition
-- the lease exists for); invocation B legitimately acquires the now-expired
-- lease and starts sending too; A finishes, and A's unconditional release
-- clears B's still-valid lease, so a third invocation C can join in. The
-- overlap the lease exists to prevent compounds instead of self-correcting.
--
-- Fix: a fencing token. Whoever acquires the lease writes a fresh random
-- uuid into `lock_token` alongside `lock_expires_at`; both the periodic
-- lease-renewal (send-campaign/index.ts's `extendDrainLock`, called after
-- every chunk so a legitimately slow drain keeps its lock instead of losing
-- it mid-send — the other half of this fix, code-only) and the final release
-- are scoped with `WHERE lock_token = <mine>`. An invocation whose lease has
-- already been reassigned to someone else then matches zero rows on both
-- calls — a correctly silent no-op — instead of touching a lease it no
-- longer owns. Bare column add, default NULL — does not touch any other
-- table.
-- =============================================================================

alter table public.email_campaign_heartbeat
  add column if not exists lock_token uuid;

comment on column public.email_campaign_heartbeat.lock_token is
  'Fencing token for the lock_expires_at lease (send-campaign/index.ts). A drain may only extend or release the lease when this matches the token it was given at acquisition — see migration header.';

-- ROLLBACK: alter table public.email_campaign_heartbeat drop column if exists lock_token;
