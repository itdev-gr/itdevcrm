-- Widen amount_net so VAT math round-trips exactly. The canonical bank-visible
-- gross stays at 2dp; the net stores enough precision that the generated
-- amount_gross matches the legacy amount column exactly for every row.
--
-- Generated columns and dependent views must be dropped before changing the
-- underlying type, then recreated. We do it all in one migration.

drop view if exists public.accounting_pl_summary_v;
drop view if exists public.accounting_ledger_v;

alter table public.deal_payments
  drop column if exists amount_gross,
  drop column if exists vat_amount;

alter table public.deal_payments
  alter column amount_net type numeric(12,4) using amount_net::numeric(12,4);

alter table public.deal_payments
  add column vat_amount numeric(12,2)
    generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  add column amount_gross numeric(12,2)
    generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored;

-- Re-backfill at full precision so gross round-trips to the legacy amount.
-- Cyprus rows (vat_rate=0) stay at amount exactly. Greek rows (vat_rate=24)
-- get round(gross * 100 / 124, 4) which gives a fourth-decimal-place net that
-- recomputes back to the original gross to within 2dp.
update public.deal_payments dp
  set amount_net = case
        when dp.vat_rate > 0 then round(dp.amount * 100.0 / (100 + dp.vat_rate), 4)
        else dp.amount
      end
  where dp.amount is not null;

-- Same treatment for the expenses table (defensively — only one row today
-- but the precision matters when users start entering non-trivial values).
alter table public.expenses
  drop column if exists amount_gross,
  drop column if exists vat_amount;

alter table public.expenses
  alter column amount_net type numeric(12,4) using amount_net::numeric(12,4);

alter table public.expenses
  add column vat_amount numeric(12,2)
    generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  add column amount_gross numeric(12,2)
    generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored;

-- Recreate the views unchanged — the column types they consume look the same
-- from outside (amount_net stays a numeric, vat_amount + amount_gross stay
-- numeric(12,2)).
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

create or replace view public.accounting_pl_summary_v
with (security_invoker = true) as
select
  period,
  sum(case when direction = 'in'  and status = 'paid' then amount_net   else 0 end) as total_income_net,
  sum(case when direction = 'in'  and status = 'paid' then vat_amount   else 0 end) as total_income_vat,
  sum(case when direction = 'in'  and status = 'paid' then amount_gross else 0 end) as total_income_gross,
  sum(case when direction = 'out' and status = 'paid' then amount_net   else 0 end) as total_expense_net,
  sum(case when direction = 'out' and status = 'paid' then vat_amount   else 0 end) as total_expense_vat,
  sum(case when direction = 'out' and status = 'paid' then amount_gross else 0 end) as total_expense_gross,
  sum(case when direction = 'in'  and status = 'paid' then amount_net   else 0 end)
    - sum(case when direction = 'out' and status = 'paid' then amount_net   else 0 end) as net_profit_net,
  sum(case when direction = 'in'  and status = 'paid' then amount_gross else 0 end)
    - sum(case when direction = 'out' and status = 'paid' then amount_gross else 0 end) as net_profit_gross
from public.accounting_ledger_v
group by period;

-- ROLLBACK:
-- drop view if exists public.accounting_pl_summary_v;
-- drop view if exists public.accounting_ledger_v;
-- alter table public.deal_payments
--   drop column if exists amount_gross,
--   drop column if exists vat_amount;
-- alter table public.deal_payments
--   alter column amount_net type numeric(12,2) using amount_net::numeric(12,2);
-- alter table public.deal_payments
--   add column vat_amount numeric(12,2)
--     generated always as (round(amount_net * vat_rate / 100, 2)) stored,
--   add column amount_gross numeric(12,2)
--     generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored;
-- (repeat the same five statements for public.expenses, then recreate both views.)
