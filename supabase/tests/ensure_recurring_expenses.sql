-- pgTAP test for ensure_recurring_expenses().
begin;
select plan(5);

insert into public.expense_categories (key, name_en, name_el, sort_order)
  values ('__test_rec', 'X', 'X', 997) on conflict (key) do nothing;

with src as (
  insert into public.expenses (category_id, vendor, billing_type, amount_net, vat_rate, start_date, end_date)
    select id, 'Acme', 'recurring_monthly', 50, 24, current_date, current_date + interval '3 days'
      from public.expense_categories where key = '__test_rec'
    returning id
)
select id as chain_root from src \gset

select is(public.ensure_recurring_expenses(), 1, 'first call creates one successor');
select is(public.ensure_recurring_expenses(), 0, 'second call is idempotent');

select is(
  (select count(*)::int from public.expenses
    where parent_expense_id = :'chain_root'),
  1,
  'successor has parent_expense_id = chain root'
);

with second as (
  insert into public.expenses (category_id, vendor, billing_type, amount_net, vat_rate, start_date, end_date)
    select id, 'Acme', 'recurring_monthly', 80, 24, current_date, current_date + interval '4 days'
      from public.expense_categories where key = '__test_rec'
    returning id
)
select id as second_chain from second \gset

select is(public.ensure_recurring_expenses(), 1, 'second independent chain renews independently');

insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, end_date)
  select id, 'one_time', 10, 24, current_date, current_date + interval '1 day'
    from public.expense_categories where key = '__test_rec';

select is(
  (select count(*)::int from public.expenses
    where billing_type = 'one_time'
      and category_id = (select id from public.expense_categories where key = '__test_rec')),
  1,
  'one_time row not extended after another renewal call'
);

select public.ensure_recurring_expenses();

select * from finish();
rollback;
