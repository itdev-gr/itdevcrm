-- pgTAP test for expenses RLS (admin-only).
begin;
select plan(2);

-- Switch to a non-admin authenticated session.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "00000000-0000-0000-0000-000000000099", "role": "authenticated"}';

select is(
  (select count(*)::int from public.expenses),
  0,
  'non-admin sees zero expense rows'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date)
       select id, 'one_time', 10, 24, current_date
         from public.expense_categories limit 1 $$,
  '42501',
  null,
  'non-admin cannot insert expenses'
);

select * from finish();
rollback;
