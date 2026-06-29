-- Audit L4 — close the dedupe TOCTOU window at the log layer.
--
-- send-email's idempotency is a read-then-insert: it SELECTs email_log for an
-- existing status='sent' row with the dedupe_key, and inserts a 'sent' row only
-- if none was found. Two concurrent same-key callers can both pass the read and
-- both insert. The queued/drain path is already serialized by claim_email_outbox
-- (FOR UPDATE SKIP LOCKED); this index adds the same guarantee at the log layer
-- as defense-in-depth: at most one 'sent' row per dedupe_key. supabase-js returns
-- (does not throw) the resulting 23505, so the losing insert is a harmless no-op.
--
-- PRECONDITION: there must be zero pre-existing duplicate ('sent', dedupe_key)
-- rows or CREATE UNIQUE INDEX fails. Verify before applying:
--   select dedupe_key, count(*) from public.email_log
--   where status = 'sent' and dedupe_key is not null
--   group by dedupe_key having count(*) > 1;
-- (Expected: 0 rows.)

CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_log_dedupe_sent
  ON public.email_log (dedupe_key)
  WHERE status = 'sent' AND dedupe_key IS NOT NULL;

-- Rollback:
-- DROP INDEX IF EXISTS public.uniq_email_log_dedupe_sent;
