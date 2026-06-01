-- pgTAP test for accounting_ledger_v.
begin;
select plan(3);

select has_view('public', 'accounting_ledger_v', 'view exists');

insert into public.expense_categories (key, name_en, name_el, sort_order)
  values ('__test_ledger', 'X', 'X', 996) on conflict (key) do nothing;

insert into public.expenses
  (category_id, vendor, billing_type, amount_net, vat_rate, start_date, status, payment_method, paid_at)
  select id, 'Vendor X', 'one_time', 100, 24, '2026-06-15', 'paid', 'bank_transfer', '2026-06-15T10:00:00Z'
    from public.expense_categories where key = '__test_ledger';

select is(
  (select count(*)::int from public.accounting_ledger_v
    where direction = 'out' and counterparty = 'Vendor X' and period = '2026-06'),
  1,
  'paid expense surfaces in ledger view'
);

select is(
  (select amount_gross from public.accounting_ledger_v
    where counterparty = 'Vendor X' and period = '2026-06'),
  124.00::numeric,
  'amount_gross propagates from generated column'
);

select * from finish();
rollback;
