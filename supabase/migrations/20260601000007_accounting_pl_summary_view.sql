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
