-- supabase/tests/domains_renewal_due_dates.sql
-- A domains renewal is billed once a year, in advance of the registry expiry
-- (see 20260806100000_domain_expiry_renewal_dates).
begin;
select plan(3);

-- "In advance" is the invariant: a domains row is entered to bill a renewal that
-- has not happened yet, so an unpaid row is never due before the day the row
-- itself was created. That is exactly what the seeded data violated — all 27
-- rows were created on 2026-08-04 carrying start_date = roughly the
-- deal-creation date (2026-04-30 … 2026-08-05), so 26 of the 27 were already
-- due before they existed as records.
--
-- Deliberately stated against created_at rather than current_date. An earlier
-- version of this assertion required start_date > current_date, which is NOT an
-- invariant: on 2026-09-03 deal 000054's corrected renewal legitimately falls
-- due, and until the client pays, correct data would fail the test. This form
-- has no dependence on the calendar and so cannot rot.
select is(
  (select count(*)::int from public.deal_payments
    where service_type = 'domains' and status <> 'paid'
      and start_date < created_at::date),
  0,
  'no unpaid domains renewal is due before the day its row was created');

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
