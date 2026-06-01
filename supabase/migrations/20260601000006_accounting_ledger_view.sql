create or replace view public.accounting_ledger_v
with (security_invoker = true) as
select
  'in'::text       as direction,
  coalesce(dp.paid_at::date, dp.start_date) as event_date,
  to_char(coalesce(dp.paid_at::date, dp.start_date), 'YYYY-MM') as period,
  dp.status,
  dp.amount_net,
  dp.vat_amount,
  dp.amount_gross,
  dp.service_type as category_key,
  c.name          as counterparty,
  dp.billing_type,
  'deal_payments'::text as source_table,
  dp.id           as source_id
from public.deal_payments dp
join public.deals d on d.id = dp.deal_id
join public.clients c on c.id = d.client_id

union all

select
  'out'::text,
  coalesce(e.paid_at::date, e.start_date),
  to_char(coalesce(e.paid_at::date, e.start_date), 'YYYY-MM'),
  e.status,
  e.amount_net,
  e.vat_amount,
  e.amount_gross,
  cat.key,
  e.vendor,
  e.billing_type,
  'expenses'::text,
  e.id
from public.expenses e
join public.expense_categories cat on cat.id = e.category_id;

-- ROLLBACK:
-- drop view if exists public.accounting_ledger_v;
