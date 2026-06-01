-- pgTAP test for expenses generated columns (vat_amount, amount_gross).
begin;
select plan(4);

insert into public.expense_categories (key, name_en, name_el, sort_order)
  values ('__test_gen', 'X', 'X', 999)
  on conflict (key) do nothing;

with new_row as (
  insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, created_by)
    select id, 'one_time', 100.00, 24.00, '2026-06-01', null
      from public.expense_categories where key = '__test_gen'
    returning vat_amount, amount_gross
)
select is(vat_amount, 24.00::numeric, 'vat_amount = 24 for net=100, rate=24') from new_row;

with new_row as (
  select vat_amount, amount_gross from public.expenses
  where amount_net = 100.00 order by created_at desc limit 1
)
select is(amount_gross, 124.00::numeric, 'amount_gross = 124 for net=100, rate=24') from new_row;

update public.expenses
  set amount_net = 200.00
  where amount_net = 100.00
    and category_id = (select id from public.expense_categories where key = '__test_gen');

select is(
  (select vat_amount from public.expenses
   where amount_net = 200.00
     and category_id = (select id from public.expense_categories where key = '__test_gen')),
  48.00::numeric,
  'vat_amount recomputes on net update'
);

select is(
  (select amount_gross from public.expenses
   where amount_net = 200.00
     and category_id = (select id from public.expense_categories where key = '__test_gen')),
  248.00::numeric,
  'amount_gross recomputes on net update'
);

select * from finish();
rollback;
