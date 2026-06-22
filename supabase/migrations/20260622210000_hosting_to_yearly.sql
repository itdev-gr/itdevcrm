-- Hosting is billed yearly. Convert every non-archived hosting job that isn't already
-- recurring_yearly (the 4 one_time ones) to recurring_yearly. amount_net holds the price and
-- is unchanged (it becomes the annual figure). Existing payments are left as-is (accounting
-- regenerates billing manually / via the UI). Reversible via the backup table.
--
-- ROLLBACK: update public.jobs j set billing_type=b.old_billing_type
--             from public.jobs_hosting_billing_backup_20260622 b where j.id=b.id;

create table if not exists public.jobs_hosting_billing_backup_20260622 (
  id uuid, old_billing_type text, backed_up_at timestamptz default now()
);

insert into public.jobs_hosting_billing_backup_20260622 (id, old_billing_type)
select id, billing_type from public.jobs
 where service_type = 'hosting' and archived = false and billing_type <> 'recurring_yearly';

update public.jobs
   set billing_type = 'recurring_yearly', updated_at = now()
 where service_type = 'hosting' and archived = false and billing_type <> 'recurring_yearly';
