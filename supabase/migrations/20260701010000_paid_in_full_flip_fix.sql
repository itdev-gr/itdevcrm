-- =========================================================================
-- 20260701000000_paid_in_full_flip_fix.sql
--
-- Four-layer fix for the paid_in_full → on_hold flip-flop:
--   1. ensure_recurring_payments idempotency by (service_type, date-range),
--      not service_index. [this file, section 1]
--   2. deal_payments_no_duplicate_period trigger — same de-scoping.
--      [section 2]
--   3. reconcile_block_lifecycle 24h grace on cron-created rows. [section 3]
--   4. Nightly reconcile_payment_integrity audit + cron + admin alert.
--      [sections 4 + 5]
--
-- Plus: cleanup (backup + delete + restore) in section 6, re-enable of
-- daily_payment_reminders cron in section 7, verbatim revert SQL in
-- section 8.
--
-- Every DDL statement is `create or replace` / `create ... if not exists`,
-- so re-running is a no-op. DML uses idempotency guards.
-- =========================================================================

-- ---- Section 1: ensure_recurring_payments guard ----------------------
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
       and (
            not exists (select 1 from public.jobs j
                         where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                           and not j.archived)
         or exists (select 1 from public.jobs j
                         where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                           and not j.archived and j.billing_active)
       )
       -- FIX (Layer 1): match by (deal_id, service_type, billing_type) with
       -- a date-range overlap. Any payment whose start_date sits on or
       -- after dp.end_date already covers the next period — regardless of
       -- service_index or status. Note: status='cancelled' is not a valid
       -- value on this schema (CHECK: pending|paid|overdue), so no extra
       -- status filter is needed.
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.service_type = dp.service_type
            and dp2.billing_type = dp.billing_type
            and dp2.start_date is not null
            and dp2.start_date >= dp.end_date
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

    insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
      values (v_payment_id,
        (select j.id from public.jobs j
          where j.deal_id = r.deal_id and j.service_type = r.service_type and not j.archived
          order by j.created_at limit 1),
        coalesce(r.label, r.service_type), r.amount_net, r.vat_rate);

    created := created + 1;
  end loop;
  return created;
end $function$;

-- ---- Section 2: deal_payments_no_duplicate_period trigger ------------
create or replace function public.deal_payments_no_duplicate_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Only guard recurring inserts (one_time and recurring_test_2min are
  -- free to have overlapping rows; historical practice for corrections).
  if new.billing_type not in ('recurring_monthly','recurring_yearly') then
    return new;
  end if;

  -- Any existing payment on the same (deal_id, service_type, billing_type,
  -- start_date, end_date) blocks the insert — regardless of service_index
  -- or amount. Silently drops so the calling INSERT succeeds without a
  -- row (matches previous behaviour on the old narrower guard). Note:
  -- status='cancelled' is not a valid value on this schema (CHECK:
  -- pending|paid|overdue), so no status filter is needed.
  if exists (
    select 1 from public.deal_payments dp
     where dp.deal_id     = new.deal_id
       and dp.service_type is not distinct from new.service_type
       and dp.billing_type = new.billing_type
       and dp.start_date  = new.start_date
       and dp.end_date    is not distinct from new.end_date
  ) then
    return null;
  end if;

  return new;
end $function$;
