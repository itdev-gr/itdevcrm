-- Header totals = sum of the payment's lines, falling back to the legacy single-row
-- columns for payments that predate lines. security_invoker so the caller's RLS applies.
create or replace view public.deal_payments_with_totals
with (security_invoker = true) as
select p.*,
  coalesce(sum(l.amount_net),   p.amount_net,   0) as total_net,
  coalesce(sum(l.vat_amount),   p.vat_amount,   0) as total_vat,
  coalesce(sum(l.amount_gross), p.amount_gross, 0) as total_gross,
  count(l.id)                                      as line_count
from public.deal_payments p
left join public.deal_payment_lines l on l.payment_id = p.id
group by p.id;

-- ROLLBACK:
-- drop view if exists public.deal_payments_with_totals;
