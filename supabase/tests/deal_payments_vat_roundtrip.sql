-- After the precision bump + re-backfill, every legacy gross must round-trip
-- exactly from the stored amount_net + vat_rate.
begin;
select plan(1);

select is(
  (select count(*)::int from public.deal_payments
     where amount is not null
       and round(amount_net * (1 + vat_rate / 100), 2) <> amount),
  0,
  'every row round-trips: round(amount_net * (1 + vat_rate/100), 2) = legacy amount'
);

select * from finish();
rollback;
