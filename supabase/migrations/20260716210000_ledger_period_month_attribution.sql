-- =============================================================================
-- Revenue/expense attribution by PERIOD month (owner decision 2026-07-16):
-- recurring (monthly + yearly) ledger rows count in the month their period
-- STARTS; one_time rows keep the paid month. Applies to BOTH arms (income =
-- deal_payments, outgo = expenses) so monthly net profit compares like with
-- like. accounting_pl_summary_v derives from this view — no change needed.
-- Frontend (useLedger/usePLSummary/exports/month filter) consumes
-- event_date/period as-is — no code changes.
-- NOTE: retroactive by design — historical recurring rows paid late move back
-- to their covered month.
--
-- ROLLBACK (manual): recreate the view with the previous event date expression
-- `COALESCE(paid_at::date, start_date)` on both arms (captured live 2026-07-16):
--   create or replace view public.accounting_ledger_v as
--   SELECT 'in'::text AS direction,
--       COALESCE(dp.paid_at::date, dp.start_date) AS event_date,
--       to_char(COALESCE(dp.paid_at::date, dp.start_date)::timestamptz, 'YYYY-MM') AS period,
--       dp.status, dp.amount_net, dp.vat_amount, dp.amount_gross,
--       dp.service_type AS category_key, c.name AS counterparty, dp.billing_type,
--       'deal_payments'::text AS source_table, dp.id AS source_id
--     FROM deal_payments dp
--       JOIN deals d ON d.id = dp.deal_id
--       JOIN clients c ON c.id = d.client_id
--   UNION ALL
--   SELECT 'out'::text, COALESCE(e.paid_at::date, e.start_date),
--       to_char(COALESCE(e.paid_at::date, e.start_date)::timestamptz, 'YYYY-MM'),
--       e.status, e.amount_net, e.vat_amount, e.amount_gross,
--       cat.key, e.vendor, e.billing_type, 'expenses'::text, e.id
--     FROM expenses e
--       JOIN expense_categories cat ON cat.id = e.category_id;
-- =============================================================================

create or replace view public.accounting_ledger_v as
select 'in'::text as direction,
       case when dp.billing_type in ('recurring_monthly','recurring_yearly')
            then dp.start_date
            else coalesce(dp.paid_at::date, dp.start_date) end as event_date,
       to_char((case when dp.billing_type in ('recurring_monthly','recurring_yearly')
                     then dp.start_date
                     else coalesce(dp.paid_at::date, dp.start_date) end)::timestamptz,
               'YYYY-MM') as period,
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
       case when e.billing_type in ('recurring_monthly','recurring_yearly')
            then e.start_date
            else coalesce(e.paid_at::date, e.start_date) end as event_date,
       to_char((case when e.billing_type in ('recurring_monthly','recurring_yearly')
                     then e.start_date
                     else coalesce(e.paid_at::date, e.start_date) end)::timestamptz,
               'YYYY-MM') as period,
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

-- Post-asserts — fail loudly if the semantics are off.
do $$
declare n int;
begin
  -- every recurring deal_payments ledger row sits in its start_date month
  select count(*) into n
    from public.accounting_ledger_v l
    join public.deal_payments dp on dp.id = l.source_id
   where l.source_table = 'deal_payments'
     and dp.billing_type in ('recurring_monthly','recurring_yearly')
     and dp.start_date is not null
     and l.period <> to_char(dp.start_date::timestamptz, 'YYYY-MM');
  if n <> 0 then
    raise exception 'ledger attribution: % recurring rows off their period month', n;
  end if;
  -- paid one_time rows keep the paid month
  select count(*) into n
    from public.accounting_ledger_v l
    join public.deal_payments dp on dp.id = l.source_id
   where l.source_table = 'deal_payments'
     and dp.billing_type = 'one_time' and dp.paid_at is not null
     and l.period <> to_char(dp.paid_at, 'YYYY-MM');
  if n <> 0 then
    raise exception 'ledger attribution: % one_time rows off their paid month', n;
  end if;
end $$;
