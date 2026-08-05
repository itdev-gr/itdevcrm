-- supabase/tests/domains_renewal_due_dates.sql
-- A domains renewal is billed once a year, in advance of the registry expiry.
-- An unpaid row due in the past means the client is being chased for a renewal
-- that has not come round yet (see 20260806100000_domain_expiry_renewal_dates).
begin;
select plan(3);

select is(
  (select count(*)::int from public.deal_payments
    where service_type = 'domains' and status <> 'paid' and start_date <= current_date),
  0,
  'no unpaid domains renewal is due today or earlier');

select is(
  (select count(*)::int from public.deal_payments
    where service_type = 'domains'
      and (end_date is null or end_date <> start_date + interval '1 year')),
  0,
  'every domains period spans exactly one year');

-- Guard the discriminating case: a row re-dated into the future must not keep
-- the 'overdue' status, because nothing in the system ever clears it
-- (mark_overdue_payments only sets it, and only when end_date is already past).
select is(
  (select count(*)::int from public.deal_payments
    where service_type = 'domains' and status = 'overdue' and end_date > current_date),
  0,
  'no domains row is marked overdue while its period is still open');

select * from finish();
rollback;
