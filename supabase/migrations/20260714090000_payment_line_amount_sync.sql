-- 2026-07-14: Payment header edits never reached deal_payment_lines.
--
-- Bug (deal 000071): accounting edited a payment's Net in the Payments table
-- (deal_payments.amount_net 220.16 → 169.36) but the Jobs & Billing card kept
-- showing €273.00. The card renders deal_payment_lines.amount_gross and the
-- deal_payments_with_totals view header total = sum of the lines — and every
-- write to deal_payment_lines is an INSERT at creation time; nothing ever
-- updated a line afterwards. 52 payments had drifted this way (repaired
-- separately, see docs/data-fixes/2026-07-14-payment-line-resync.sql).
--
-- Fix 1: AFTER UPDATE trigger on deal_payments mirrors amount_net/vat_rate
--   into the payment's breakdown line. Single-line payments only: with more
--   than one line the split is ambiguous (all 680 prod payments with lines
--   have exactly one as of 2026-07-14; multi-line payments are left alone).
-- Fix 2: ensure_recurring_payments labels spawned lines with the job title
--   (matching the initial generator) instead of the raw service_type code
--   ("Local seo" vs "local_seo" on the card). Body otherwise VERBATIM from
--   20260713151000_recurring_link_by_billing_type.sql — drift-checked against
--   the live def on 2026-07-14: identical.
--
-- ROLLBACK:
--   drop trigger if exists deal_payments_sync_line_amounts on public.deal_payments;
--   drop function if exists public.sync_payment_line_amounts();
--   re-apply ensure_recurring_payments body from
--   20260713151000_recurring_link_by_billing_type.sql (drift-check live first).

-- ---- Fix 1: mirror header amount edits into the single breakdown line -----
create or replace function public.sync_payment_line_amounts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.deal_payment_lines l
     set amount_net = new.amount_net,
         vat_rate   = new.vat_rate
   where l.payment_id = new.id
     and (l.amount_net is distinct from new.amount_net
          or l.vat_rate is distinct from new.vat_rate)
     and (select count(*) from public.deal_payment_lines dpl
           where dpl.payment_id = new.id) = 1;
  return new;
end $$;

drop trigger if exists deal_payments_sync_line_amounts on public.deal_payments;
create trigger deal_payments_sync_line_amounts
  after update of amount_net, vat_rate on public.deal_payments
  for each row execute function public.sync_payment_line_amounts();

-- ---- Fix 2: recurring-spawned lines get the job title as label ------------
-- Only the `label` expression in the deal_payment_lines insert differs from
-- the 20260713151000 base body.
create or replace function public.ensure_recurring_payments()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record; next_start date; next_end date; created int := 0; v_payment_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('ensure_recurring_payments')::bigint);

  for r in
    select dp.*
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.end_date is not null
       and dp.end_date <= current_date + interval '7 days'
       and d.archived = false
       and coalesce((select ps.code from public.pipeline_stages ps
                      where ps.id = d.accounting_stage_id), '') <> 'closed'
       -- Section 2: legacy `not exists (jobs)` OR-branch removed.
       -- Audit 2026-07-02 confirmed 0 prod deals relied on it.
       -- Cron now requires at least one active billing_active job.
       and exists (select 1 from public.jobs j
                    where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                      and j.billing_type = dp.billing_type
                      and not j.archived and j.billing_active)
       -- Section 1+6: guard by end_date > dp.end_date (was start_date >= dp.end_date).
       -- Catches accountant-driven end_date extension. `is not distinct from`
       -- is null-safe for service_type.
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.service_type is not distinct from dp.service_type
            and dp2.billing_type = dp.billing_type
            and dp2.end_date is not null
            and dp2.end_date > dp.end_date
       )
  loop
    next_start := r.end_date;
    if r.billing_type = 'recurring_monthly' then
      next_end := next_start + interval '1 month';
    else
      next_end := next_start + interval '1 year';
    end if;

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount_net, r.vat_rate, next_start, next_end)
      returning id into v_payment_id;

    -- Defensive: the deal_payments_no_duplicate_period BEFORE INSERT trigger
    -- returns null on exact-period duplicates, in which case v_payment_id is
    -- NULL. Two candidate rows in one loop iteration can produce identical
    -- next-period inserts (e.g. anomalous rows with end_date=start_date).
    -- Skip the deal_payment_lines insert instead of crashing on NOT NULL.
    if v_payment_id is null then
      continue;
    end if;

    insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
      values (v_payment_id,
        (select j.id from public.jobs j
          where j.deal_id = r.deal_id and j.service_type = r.service_type and not j.archived
            and j.billing_type = r.billing_type
          order by j.created_at limit 1),
        coalesce(r.label,
          (select nullif(j.title, '') from public.jobs j
            where j.deal_id = r.deal_id and j.service_type = r.service_type and not j.archived
              and j.billing_type = r.billing_type
            order by j.created_at limit 1),
          r.service_type),
        r.amount_net, r.vat_rate);

    created := created + 1;
  end loop;
  return created;
end $function$;
