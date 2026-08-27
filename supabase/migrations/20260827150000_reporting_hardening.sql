-- =============================================================================
-- 2026-08-27: Reporting hardening — fixes from the expenses/reporting audit
-- (docs/system-analysis/2026-08-27-expenses-reporting-audit.md).
--
-- 1. pl_summary_for_range(): server-side P&L aggregation for any date range.
--    Replaces the client-side row-fetch aggregation in usePLSummary, which
--    silently lost ALL expense rows once the ledger crossed supabase-js's
--    1000-row cap (E22 — YTD expenses displayed €0.00). An SQL aggregate can
--    never be row-capped. SECURITY INVOKER: same RLS semantics the client
--    query had.
-- 2. accounting_ledger_v gains deal_id + deal_code APPENDED columns on the
--    income arm (E33 — no deal identity reached exports). CREATE OR REPLACE
--    VIEW appends columns without disturbing existing consumers; the
--    security_invoker option from 20260803130000 is restated explicitly so
--    the replace cannot drop it.
-- 3. expenses_skip_duplicate_period trigger: a recurring expense period that
--    already exists (vendor + billing_type + start_date) is silently skipped
--    at insert — closes the latent chain-fracture duplicate-spawn risk (E13)
--    at the database level, mirroring deal_payments_no_duplicate_period.
-- 4. expenses_propagate_amount_forward trigger: editing amount_net/vat_rate
--    on a recurring expense row updates the chain's FUTURE pending periods,
--    so a price correction can no longer strand an already-spawned next
--    period at the old amount (E12 — the SUPABASE €228→€216 case).
--
-- No function here previously existed (fresh objects) except the view:
-- base 20260717120000_revert_ledger_collection_month.sql, security_invoker
-- from 20260803130000. md5 pre/post of the view captured in deploy output.
-- =============================================================================

-- 1. Server-side P&L for a range. Income counts paid rows only, always;
--    expenses count paid plus (opt-in) pending — the exact rule the Report
--    page has today, now computed where row caps cannot exist.
create or replace function public.pl_summary_for_range(
  p_from date,
  p_to date,
  p_include_pending_expenses boolean default false
)
returns table (
  total_income_net    numeric,
  total_income_vat    numeric,
  total_income_gross  numeric,
  total_expense_net   numeric,
  total_expense_vat   numeric,
  total_expense_gross numeric,
  net_profit_net      numeric,
  net_profit_gross    numeric,
  income_rows         bigint,
  expense_rows        bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with r as (
    select direction, status, amount_net, vat_amount, amount_gross
      from public.accounting_ledger_v
     where event_date between p_from and p_to
  ),
  agg as (
    select
      coalesce(sum(amount_net)   filter (where direction = 'in'  and status = 'paid'), 0) as in_net,
      coalesce(sum(vat_amount)   filter (where direction = 'in'  and status = 'paid'), 0) as in_vat,
      coalesce(sum(amount_gross) filter (where direction = 'in'  and status = 'paid'), 0) as in_gross,
      coalesce(count(*)          filter (where direction = 'in'  and status = 'paid'), 0) as in_rows,
      coalesce(sum(amount_net)   filter (where direction = 'out' and (status = 'paid'
        or (p_include_pending_expenses and status = 'pending'))), 0) as out_net,
      coalesce(sum(vat_amount)   filter (where direction = 'out' and (status = 'paid'
        or (p_include_pending_expenses and status = 'pending'))), 0) as out_vat,
      coalesce(sum(amount_gross) filter (where direction = 'out' and (status = 'paid'
        or (p_include_pending_expenses and status = 'pending'))), 0) as out_gross,
      coalesce(count(*)          filter (where direction = 'out' and (status = 'paid'
        or (p_include_pending_expenses and status = 'pending'))), 0) as out_rows
    from r
  )
  select in_net, in_vat, in_gross, out_net, out_vat, out_gross,
         in_net - out_net, in_gross - out_gross, in_rows, out_rows
  from agg;
$$;
grant execute on function public.pl_summary_for_range(date, date, boolean) to authenticated;

-- 2. Ledger view: append deal_id + deal_code (income arm; nulls on expenses).
--    Column list before the two appended ones is IDENTICAL to 20260717120000.
create or replace view public.accounting_ledger_v
with (security_invoker = true) as
  select 'in'::text as direction,
         coalesce(dp.paid_at::date, dp.start_date) as event_date,
         to_char(coalesce(dp.paid_at::date, dp.start_date)::timestamptz, 'YYYY-MM') as period,
         dp.status,
         dp.amount_net,
         dp.vat_amount,
         dp.amount_gross,
         dp.service_type as category_key,
         c.name as counterparty,
         dp.billing_type,
         'deal_payments'::text as source_table,
         dp.id as source_id,
         d.id as deal_id,
         d.code as deal_code
    from deal_payments dp
    join deals d on d.id = dp.deal_id
    join clients c on c.id = d.client_id
  union all
  select 'out'::text as direction,
         coalesce(e.paid_at::date, e.start_date) as event_date,
         to_char(coalesce(e.paid_at::date, e.start_date)::timestamptz, 'YYYY-MM') as period,
         e.status,
         e.amount_net,
         e.vat_amount,
         e.amount_gross,
         cat.key as category_key,
         e.vendor as counterparty,
         e.billing_type,
         'expenses'::text as source_table,
         e.id as source_id,
         null::uuid as deal_id,
         null::text as deal_code
    from expenses e
    join expense_categories cat on cat.id = e.category_id;

-- 3. Recurring expense periods can never duplicate (vendor+billing+start).
create or replace function public.expenses_skip_duplicate_period()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.billing_type in ('recurring_monthly', 'recurring_yearly') and exists (
    select 1 from public.expenses e
     where e.vendor = new.vendor
       and e.billing_type = new.billing_type
       and e.start_date = new.start_date
  ) then
    return null; -- silently skip, mirroring deal_payments_no_duplicate_period
  end if;
  return new;
end $$;

drop trigger if exists expenses_skip_duplicate_period_trg on public.expenses;
create trigger expenses_skip_duplicate_period_trg
  before insert on public.expenses
  for each row execute function public.expenses_skip_duplicate_period();

-- 4. Price corrections flow forward into already-spawned pending periods.
create or replace function public.expenses_propagate_amount_forward()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if; -- no cascade recursion
  if new.billing_type in ('recurring_monthly', 'recurring_yearly')
     and (new.amount_net is distinct from old.amount_net
       or new.vat_rate is distinct from old.vat_rate) then
    update public.expenses
       set amount_net = new.amount_net,
           vat_rate   = new.vat_rate,
           updated_at = now()
     where vendor = new.vendor
       and billing_type = new.billing_type
       and status = 'pending'
       and start_date > new.start_date;
  end if;
  return new;
end $$;

drop trigger if exists expenses_propagate_amount_forward_trg on public.expenses;
create trigger expenses_propagate_amount_forward_trg
  after update on public.expenses
  for each row execute function public.expenses_propagate_amount_forward();

-- ROLLBACK:
--   drop trigger if exists expenses_propagate_amount_forward_trg on public.expenses;
--   drop function if exists public.expenses_propagate_amount_forward();
--   drop trigger if exists expenses_skip_duplicate_period_trg on public.expenses;
--   drop function if exists public.expenses_skip_duplicate_period();
--   drop function if exists public.pl_summary_for_range(date, date, boolean);
--   -- view: re-apply the 20260717120000 definition (12 columns) — CREATE OR
--   -- REPLACE cannot drop columns, so: drop view public.accounting_ledger_v;
--   -- then recreate from 20260717120000 with (security_invoker = true),
--   -- then re-grant select to authenticated.
