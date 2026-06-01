-- pgTAP test for expense_categories seed.
-- Run with: supabase test db expense_categories_seed (requires local Supabase).
begin;
select plan(3);

select has_table('public', 'expense_categories', 'expense_categories table exists');

select is(
  (select count(*)::int from public.expense_categories),
  15,
  '15 categories seeded'
);

select results_eq(
  $$ select key from public.expense_categories order by sort_order $$,
  $$ values
       ('salaries'),('freelancers'),('rent'),('utilities'),('software'),
       ('hosting_domains'),('ads_spend'),('equipment'),('taxes_vat'),
       ('accountant_fees'),('bank_fees'),('marketing'),('training'),
       ('travel'),('other')
  $$,
  'seeded keys are in expected order'
);

select * from finish();
rollback;
