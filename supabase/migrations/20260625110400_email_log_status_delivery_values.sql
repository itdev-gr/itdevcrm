-- 20260625110400_email_log_status_delivery_values.sql
-- The Resend delivery webhook sets status to delivered/bounced/complained, but
-- email_log_status_check only allowed 'sent'/'failed' — so those updates would
-- be rejected in prod. Broaden the allowed set. (Caught by the Phase 2 smoke.)
alter table public.email_log drop constraint if exists email_log_status_check;
alter table public.email_log add constraint email_log_status_check
  check (status = any (array['sent','failed','delivered','bounced','complained']));

-- ROLLBACK:
--   alter table public.email_log drop constraint if exists email_log_status_check;
--   alter table public.email_log add constraint email_log_status_check
--     check (status = any (array['sent','failed']));
