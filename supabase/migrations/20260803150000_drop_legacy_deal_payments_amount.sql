-- Drop the legacy deal_payments.amount column (deprecated in 20260601000005,
-- planned "drop after 2026-07-01"). Audit 2026-08-03: every live function/RPC/
-- trigger writes amount_net; no component reads the bare column; 301/303 July
-- rows carried 0 in it. It already caused one reporting bug (queries summing
-- `amount` silently get zeros).
--
-- deal_payments_with_totals selects p.*, so Postgres blocks the drop until the
-- view is recreated: drop view → drop column → recreate with the SAME body
-- (p.* now excludes amount). security_invoker preserved; Supabase default
-- privileges re-grant SELECT on recreation.

drop view public.deal_payments_with_totals;

alter table public.deal_payments drop column amount;

create view public.deal_payments_with_totals
with (security_invoker = true) as
select p.*,
  coalesce(sum(l.amount_net),   p.amount_net,   0) as total_net,
  coalesce(sum(l.vat_amount),   p.vat_amount,   0) as total_vat,
  coalesce(sum(l.amount_gross), p.amount_gross, 0) as total_gross,
  count(l.id)                                      as line_count
from public.deal_payments p
left join public.deal_payment_lines l on l.payment_id = p.id
group by p.id;

-- ROLLBACK (legacy values are unrecoverable by design; non-zero pairs were
-- snapshotted to the session scratchpad before the drop):
-- drop view public.deal_payments_with_totals;
-- alter table public.deal_payments add column amount numeric(12,2) not null default 0;
-- create view public.deal_payments_with_totals with (security_invoker = true) as
--   select p.*, coalesce(sum(l.amount_net), p.amount_net, 0) as total_net,
--     coalesce(sum(l.vat_amount), p.vat_amount, 0) as total_vat,
--     coalesce(sum(l.amount_gross), p.amount_gross, 0) as total_gross,
--     count(l.id) as line_count
--   from public.deal_payments p
--   left join public.deal_payment_lines l on l.payment_id = p.id group by p.id;
