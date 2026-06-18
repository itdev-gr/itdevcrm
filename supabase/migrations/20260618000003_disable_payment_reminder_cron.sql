-- Disable the accounting payment-reminder cron so NO automated accounting emails
-- go out, after the ClickUp deal/payment migration (avoid emailing clients on
-- imported, possibly-wrong amounts/dates). enqueue_payment_reminders is the only
-- function that queues accounting-identity emails. Re-enable when billing is verified.
select cron.alter_job((select jobid from cron.job where jobname = 'daily_payment_reminders'), active := false);

-- ROLLBACK:
-- select cron.alter_job((select jobid from cron.job where jobname = 'daily_payment_reminders'), active := true);
