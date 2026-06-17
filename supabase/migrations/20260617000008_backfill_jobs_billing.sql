-- Backfill the new job billing fields from the existing amount columns, so every
-- current job behaves as a billing unit. amount_net is a brand-new column (all rows
-- null), so this touches every job once. vat_rate is country-aware (Cyprus 0, else 24)
-- for correct FUTURE generation; existing payments keep their own vat on their lines.
update public.jobs j set
  amount_net = coalesce(
    case when j.billing_type = 'one_time' then j.one_time_amount else j.monthly_amount end, 0),
  title = coalesce(nullif(j.title, ''), initcap(replace(j.service_type, '_', ' '))),
  vat_rate = case
    when exists (select 1 from public.clients c
                  where c.id = j.client_id and c.country ilike 'cyprus') then 0.00
    else 24.00 end
where j.amount_net is null;

-- ROLLBACK: (content backfill into new nullable columns; revert by dropping the columns
--            in 20260617000005's rollback — no separate undo needed)
