-- =============================================================================
-- email_outbox: allow the info@ sender identity (2026-08-10)
--
-- WHY. The send-email function gained an `info` identity
-- (IT DEV <info@itdev.gr>) for one-off company-wide announcements — the first
-- being the summer 2026 closure notice. The outbox CHECK constraint still
-- listed only sales/accounting/internal, so enqueueing an info@ send violated
-- email_outbox_identity_check before the drain ever saw the row.
--
-- WHAT. Recreate the constraint with 'info' included. email_log has no
-- identity constraint (it already stores 'personal'), so nothing else changes.
-- =============================================================================

alter table public.email_outbox
  drop constraint email_outbox_identity_check;

alter table public.email_outbox
  add constraint email_outbox_identity_check
  check (identity = any (array['sales'::text, 'accounting'::text, 'internal'::text, 'info'::text]));
