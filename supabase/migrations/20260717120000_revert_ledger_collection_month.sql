-- =============================================================================
-- Revert the 2026-07-16 revenue-attribution change (20260716210000).
--
-- That migration filed recurring_monthly/recurring_yearly ledger rows by their
-- COVERED period month (start_date) instead of the COLLECTION month
-- (coalesce(paid_at, start_date)). It was built on a spec ASSUMPTION while the
-- owner was away ("OWNER MUST CONFIRM before build"). Owner confirmed on
-- 2026-07-17 they want CASH-BASIS: recurring revenue (and expenses) show in the
-- month the money was actually collected/paid — the pre-07-16 behavior.
--
-- Effect: overdue periods paid late, and prepaid future periods, once again
-- appear in the month they were collected (e.g. a June period paid in July, and
-- a 3-month prepayment collected in July, all show in July's Report/P&L).
--
-- Only the event_date/period expression changes; all columns, joins and the
-- expenses arm are otherwise identical to the live definition. `accounting_pl_
-- summary_v`, useLedger/usePLSummary/useMRR consume period/event_date unchanged.
--
-- ROLLBACK: restore 20260716210000_ledger_period_month_attribution.sql's
-- start_date CASE for the two recurring billing types.
-- =============================================================================

create or replace view public.accounting_ledger_v as
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
         dp.id as source_id
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
         e.id as source_id
    from expenses e
    join expense_categories cat on cat.id = e.category_id;
