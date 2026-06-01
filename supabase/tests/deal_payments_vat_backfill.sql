-- pgTAP test for deal_payments VAT backfill.
begin;
select plan(2);

select is(
  (select count(*)::int from public.deal_payments
     where amount is not null
       and abs(amount_gross - amount) > 0.02),
  0,
  'every legacy amount within €0.02 of generated amount_gross'
);

select is(
  (select round(sum(amount_net + vat_amount), 2)
     from public.deal_payments),
  (select round(sum(amount_gross), 2)
     from public.deal_payments),
  'sum(net + vat) = sum(gross) for the whole table'
);

select * from finish();
rollback;
