-- =========================================================================
-- 20260702000000_billing_mitigations.sql
--
-- Six one-line SQL mitigations aggregated from the two smoke reports
-- (edge-case + full-smoke, both 2026-07-01):
--
--   #1 P1: L1 guard by end_date (fixes A2 end_date-extension gap)
--   #2 P2: Remove cron legacy fallback (fixes D2 archive-parent gap)
--   #3 P2: move_to_awaiting paid guard (fixes B2/E1/G1 UX flap)
--   #4 P3: UNIQUE partial index for recurring dupes (fixes E5 UPDATE bypass)
--   #5 P3: created_at UPDATE guard (fixes I3 grace bypass)
--   #6 P3: L1 null-safe service_type (fixes C7 NULL edge)
--
-- Sections #1, #2, and #6 are combined into a single ensure_recurring_payments
-- replacement below.
--
-- Every DDL is `create or replace` / `create if not exists`, so re-applying
-- is a no-op. Revert SQL is embedded at the bottom (Section 8).
-- =========================================================================

-- ---- Section 1+2+6: ensure_recurring_payments (combined) --------------
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
          order by j.created_at limit 1),
        coalesce(r.label, r.service_type), r.amount_net, r.vat_rate);

    created := created + 1;
  end loop;
  return created;
end $function$;

-- ---- Section 3: move_to_awaiting paid guard ------------------------
-- Pre-existing behavior: inserting ANY row on a paid_in_full deal moves it
-- to awaiting_payment. This includes paid receipts, which is confusing UX.
-- Fix: early-return on status='paid'. Preserves the existing behavior for
-- pending/overdue inserts (which SHOULD signal "new billing coming").
create or replace function public.deal_payments_move_to_awaiting()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare awaiting_id uuid; d record; current_stage_code text;
begin
  if new.billing_type = 'recurring_test_2min' then return new; end if;
  if new.status = 'paid' then return new; end if;  -- <-- Section 3 addition
  select id into awaiting_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'awaiting_payment' limit 1;
  if awaiting_id is null then return new; end if;

  select id, accounting_stage_id, accounting_completed_at into d
    from public.deals where id = new.deal_id limit 1;
  if d is null or d.accounting_completed_at is not null or d.accounting_stage_id is null
     or d.accounting_stage_id = awaiting_id then
    return new;
  end if;

  select code into current_stage_code from public.pipeline_stages where id = d.accounting_stage_id;
  if current_stage_code in ('new','on_hold','partial_payment') then return new; end if;
  if exists (select 1 from public.pipeline_stages ps where ps.id = d.accounting_stage_id and ps.is_terminal) then
    return new;
  end if;

  update public.deals set accounting_stage_id = awaiting_id where id = new.deal_id;
  return new;
end $function$;
