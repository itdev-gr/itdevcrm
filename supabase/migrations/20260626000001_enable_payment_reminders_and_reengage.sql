-- Re-enable two email automations the user explicitly confirmed on 2026-06-26:
--  1. daily_payment_reminders cron — disabled 2026-06-18 (20260618000003) pending ClickUp
--     billing verification; user confirmed billing is now trustworthy. The per-deal
--     deals.suppress_payment_reminders backstop (20260626000000) is in place.
--  2. reengage 90-day sequence (not_interested / dead_end leads) — was a strategic OFF.
--
-- Not enabled (left OFF on purpose): call-scheduling emails (scheduled_confirm/reminder/
-- noshow, "pending rework") and the `global` internal switch.

select cron.alter_job((select jobid from cron.job where jobname = 'daily_payment_reminders'), active := true);

update public.email_sequences set enabled = true, updated_at = now() where key = 'reengage';

-- ROLLBACK:
--   select cron.alter_job((select jobid from cron.job where jobname = 'daily_payment_reminders'), active := false);
--   update public.email_sequences set enabled = false where key = 'reengage';
