-- =============================================================================
-- 2026-08-26: Fix A0 (audit docs/system-analysis/2026-08-26-payment-system-audit.md)
-- Cash/no-VAT deals were charged VAT on their PAYMENT rows: seed_deal_payments()
-- computed VAT from country only and never checked deals.cash_charge_vat, unlike
-- release_billing_jobs_for_deal / release_jobs_for_deal (which is why the jobs
-- were right and the payment rows wrong). ensure_recurring_payments() then copied
-- the wrong vat_rate forward verbatim every renewal, making the defect permanent.
-- 12 deals / 19 paid rows / €977.11 wrongly collected as of 2026-08-26 (F11).
--
-- Scope (deliberately A0-only):
--   1. seed_deal_payments: same cash-guard the job-release fns carry.
--   2. ensure_recurring_payments: on cash/no-VAT deals the next period is seeded
--      at 0% regardless of what the previous row carried. All OTHER deals keep
--      the copy-forward behaviour — the mirror bug B3 (online deals stuck at 0%)
--      raises client invoices and stays gated on the owner's section-C decision.
--   3. Data repair (below): vat_rate -> 0 on UNPAID (pending/overdue) rows of
--      cash/no-VAT deals only. Paid rows (€977.11) untouched — owner decision.
--
-- Bases (drift-checked against live 2026-08-26, md5 pre/post in deploy output):
--   seed_deal_payments        <- 20260720170000_vat_rate_for_country_helper.sql
--                                (live md5 640439c421e13d49cd8e1eaa161cc70b)
--   ensure_recurring_payments <- 20260806210000_ensure_recurring_ignores_cancelled.sql
--                                (live md5 931fec15e8fb8df99cf96f10b9fbc93c)
-- Bodies below are the live definitions verbatim; ONLY the marked VAT lines change.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seed_deal_payments(target_deal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record; svc jsonb; idx int := 0; s_start date; s_end date;
  net numeric(12,4); setup_net numeric(12,4); vat numeric(5,2);
  client_country text; bt text; st text; term text; pct numeric[]; i int;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return; end if;
  if exists (select 1 from public.deal_payments where deal_id = d.id) then return; end if;
  if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then return; end if;

  select c.country into client_country from public.clients c where c.id = d.client_id;
  -- A0 fix (2026-08-26): same rule as release_billing_jobs_for_deal — a cash
  -- deal without cash_charge_vat bills 0%, everything else by country.
  vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    else public.vat_rate_for_country(client_country) end;
  s_start := coalesce(d.actual_close_date, current_date);

  for svc in select * from jsonb_array_elements(d.services_planned)
  loop
    bt := coalesce(svc->>'billing_type', 'one_time');
    st := svc->>'service_type';
    term := svc->>'payment_terms';
    setup_net := coalesce(nullif(svc->>'setup_fee','')::numeric, 0);

    if bt = 'one_time' and st = 'web_dev' and term in ('50_50', '50_25_25') then
      -- Website paid in installments: split the one-time total.
      net := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0);
      pct := case when term = '50_25_25' then array[0.5, 0.25, 0.25]::numeric[]
                  else array[0.5, 0.5]::numeric[] end;
      for i in 1 .. array_length(pct, 1) loop
        insert into public.deal_payments
          (deal_id, service_type, service_index, billing_type, amount_net, vat_rate,
           start_date, end_date, label)
          values (d.id, st, idx, 'one_time', round(net * pct[i], 4), vat, s_start, s_start,
                  'Installment ' || i || '/' || array_length(pct, 1));
        idx := idx + 1;
      end loop;
    else
      -- one_time (incl. 'full'/no term), recurring_monthly, recurring_yearly.
      if bt = 'one_time' then
        net := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0); s_end := s_start;
      elsif bt = 'recurring_monthly' then
        net := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0); s_end := s_start + interval '1 month';
      elsif bt = 'recurring_yearly' then
        net := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0); s_end := s_start + interval '1 year';
      else
        net := 0; s_end := s_start;
      end if;
      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
        values (d.id, st, idx, bt, round(net, 4), vat, s_start, s_end);
      idx := idx + 1;
    end if;

    if setup_net > 0 then
      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate,
         start_date, end_date, label)
        values (d.id, st, idx, 'one_time', round(setup_net, 4), vat, s_start, s_start, 'Setup fee');
      idx := idx + 1;
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_recurring_payments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; next_start date; next_end date; created int := 0; v_payment_id uuid;
  v_vat numeric(5,2);
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
       -- A5 (2026-08-06): never extend FROM a cancelled period. job_pause_billing
       -- voids a chain's unpaid rows; without this the generator would treat the
       -- voided row as the head of the chain and copy its amount forward.
       and dp.status <> 'cancelled'
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
            -- A5 (2026-08-06): a cancelled row must not count as "a newer period
            -- already exists". A future-dated one would otherwise block the live
            -- row beneath it indefinitely — silently, with no invoice raised.
            and dp2.status <> 'cancelled'
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

    -- A0 fix (2026-08-26): a cash/no-VAT deal never inherits a wrong 24% from
    -- the previous period — its renewals are always 0%. Every other deal keeps
    -- the historical copy-forward (raising a 0% chain to 24% is the mirror bug
    -- B3, gated on the owner's decision because it changes client invoices).
    select case
        when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
        else r.vat_rate end
      into v_vat
      from public.deals d where d.id = r.deal_id;

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount_net, v_vat, next_start, next_end)
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
        r.amount_net, v_vat);

    created := created + 1;
  end loop;
  return created;
end $function$;

-- ROLLBACK:
--   Restore both bodies from their base migrations (drift-check live md5 first):
--   seed_deal_payments        -> 20260720170000_vat_rate_for_country_helper.sql
--   ensure_recurring_payments -> 20260806210000_ensure_recurring_ignores_cancelled.sql
--   Data repair revert: docs/data-fixes/2026-08-26-cash-vat-unpaid-repair.md
--   lists every (id, old vat_rate) pair the deploy script zeroed.
