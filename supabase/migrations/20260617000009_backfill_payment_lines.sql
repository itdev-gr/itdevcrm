-- Convert each existing payment into header + one line, preserving the exact amount.
-- job_id is resolved by matching service_type on the same deal (null if no live job).
-- The line copies the payment's own amount_net + vat_rate, so the generated amount_gross
-- on the line equals the payment's amount_gross exactly (parity).
insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
select p.id,
       (select j.id from public.jobs j
         where j.deal_id = p.deal_id and j.service_type = p.service_type and not j.archived
         order by j.created_at limit 1),
       coalesce(p.label, p.service_type),
       p.amount_net,
       p.vat_rate
from public.deal_payments p
where not exists (select 1 from public.deal_payment_lines l where l.payment_id = p.id);

-- ROLLBACK (only safe pre-cutover, while header columns are still authoritative):
-- delete from public.deal_payment_lines;
