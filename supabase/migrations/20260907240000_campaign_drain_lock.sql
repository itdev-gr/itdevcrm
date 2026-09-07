-- =============================================================================
-- 20260907240000_campaign_drain_lock.sql
-- Review fix (task-5-review.md, Important-2): nothing previously serialised
-- overlapping send-campaign drain() invocations. drain_campaign_sends fires
-- every minute via fire-and-forget net.http_post (20260907220000:385-398) —
-- it does not wait for the previous call. If Resend is slow, two or three
-- invocations can be mid-flight at once; campaign_daily_budget() only
-- subtracts rows already at status='sent' (not the in-flight 'sending' rows
-- an overlapping invocation cannot see), so each overlapping invocation
-- computes the same leftover budget and claims on top of what the other is
-- already sending — the daily/hourly cap can be exceeded, and the combined
-- Resend request rate can pass the team's 10 req/s limit, at which point
-- send-email's own transactional traffic starts taking 429s too.
--
-- Why this is a lease column, not a literal pg_try_advisory_lock() call:
-- send-campaign/index.ts talks to Postgres only through PostgREST
-- (supabase-js), which is pooled per-request — each `.rpc()`/`.from()` call
-- may run on a different backend connection, and a request's connection is
-- returned to the pool as soon as that single request finishes. A session-
-- scoped advisory lock (pg_try_advisory_lock/pg_advisory_unlock) taken in one
-- call and released in a later call would not actually protect the drain: it
-- would be tied to whichever backend served the *first* call, and either
-- silently release the instant that connection returns to the pool, or —
-- worse, under transaction-mode pooling — leak onto a completely unrelated
-- future request that happens to reuse the same pooled backend. A
-- transaction-scoped advisory lock (pg_try_advisory_xact_lock) has the
-- opposite problem: it releases at the end of the single request/transaction
-- that took it, which ends long before the drain's multi-chunk Resend calls
-- are done. Holding a *real* advisory lock for the duration of one
-- Deno.serve invocation would require opening and keeping open a single raw
-- Postgres connection from the edge function for that whole invocation —
-- nothing in this codebase does that; every function talks to Postgres via
-- PostgREST.
--
-- So this migration adds an explicit, atomic, self-expiring lease on a
-- single row instead: `email_campaign_heartbeat.lock_expires_at`. Acquiring
-- the lease is one `UPDATE ... WHERE id = true AND (lock_expires_at IS NULL
-- OR lock_expires_at < now()) RETURNING id` — a single statement, so
-- Postgres's own row-level locking makes the compare-and-set atomic across
-- concurrent callers even though each caller may be on a different pooled
-- connection: only one concurrent UPDATE can ever see the WHERE clause still
-- true. This gives the same mutual-exclusion property as an advisory lock,
-- with a hard expiry (so a crashed invocation can never wedge every future
-- drain shut) and no requirement on connection lifetime. Bare column add,
-- default NULL — does not touch any other table.
-- =============================================================================

alter table public.email_campaign_heartbeat
  add column if not exists lock_expires_at timestamptz;

comment on column public.email_campaign_heartbeat.lock_expires_at is
  'Drain-invocation lease expiry (send-campaign/index.ts). NULL or in the past = free to acquire. See migration header for why this is a lease, not a literal pg_try_advisory_lock().';

-- ROLLBACK: alter table public.email_campaign_heartbeat drop column if exists lock_expires_at;
