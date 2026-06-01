-- pgTAP test for expenses check constraints.
begin;
select plan(5);

insert into public.expense_categories (key, name_en, name_el, sort_order)
  values ('__test_cc', 'X', 'X', 998) on conflict (key) do nothing;

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, status)
       select id, 'one_time', 10, 24, '2026-06-01', 'paid'
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'paid without paid_at rejected'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, status, paid_at)
       select id, 'one_time', 10, 24, '2026-06-01', 'paid', now()
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'paid without payment_method rejected'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date)
       select id, 'one_time', -1, 24, '2026-06-01'
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'negative amount_net rejected'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date)
       select id, 'one_time', 10, 150, '2026-06-01'
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'vat_rate > 100 rejected'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, end_date)
       select id, 'one_time', 10, 24, '2026-06-10', '2026-06-01'
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'end_date before start_date rejected'
);

select * from finish();
rollback;
