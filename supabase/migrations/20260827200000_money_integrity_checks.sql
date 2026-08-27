-- =============================================================================
-- Task 5 of the 2026-08-27 financial-correctness program: watch the money
-- itself. One helper function encodes the VAT rule in a single place, and
-- five new checks (26-30) point the existing integrity sweep at deal_payments
-- and expenses instead of only jobs/deals/clients.
--
-- Step 1 — public.deal_vat_rate(p_deal_id uuid): THE single VAT rule (cash/
-- no-VAT deals bill 0%, everything else bills by client country via the
-- existing vat_rate_for_country helper). Both seed_deal_payments and
-- ensure_recurring_payments grew an inline copy of the cash half of this rule
-- in 20260826150000_cash_vat_payment_seeding.sql (fix A0); this migration
-- points both at the new helper instead of re-deriving it inline.
--
--   seed_deal_payments: the CASE was already IDENTICAL to deal_vat_rate (cash
--     test, else vat_rate_for_country(country)) — pure refactor, one call
--     replaces the inline CASE and the now-unused client_country lookup.
--
--   ensure_recurring_payments: NOT a pure refactor target. Its ELSE branch is
--   deliberately r.vat_rate (copy the previous period forward), not a fresh
--   country lookup — raising a 0%-stuck chain to 24% is the mirror bug B3,
--   gated on the owner's decision because it would silently re-invoice a
--   client. Only the cash-zero value is delegated to deal_vat_rate() (which
--   always evaluates to 0.00 on that branch, so this is behaviourally
--   identical); the copy-forward else-branch is untouched.
--
-- Step 2 — checks 26-30 appended to accounting_integrity_alerts(), verbatim
-- body + new UNION ALL branches. Base: 20260806170000_invisible_card_alert.sql
-- (25 checks). Drift-checked live 2026-08-27 immediately before writing this
-- migration: live md5(pg_get_functiondef) = b477063586f74cbfa131df06722715de,
-- matching that migration's own recorded post-change md5 — no drift, body
-- below is copied verbatim from the live definition.
--
--   26 payment_vat_mismatch — the check A0 proved was completely missing (0 of
--      27 broken rows were visible anywhere). Non-cancelled deal_payments rows
--      whose vat_rate disagrees with deal_vat_rate(deal_id). Measured on prod
--      2026-08-27 immediately before writing this migration: 46 rows (25 A0
--      cash-charged-VAT rows + 21 B3 online-deal-stuck-at-0% rows, incl. the
--      000229/000935 pair) — EXPECTED to fire on both populations until the
--      owner decides them; visible != forgotten is the point of this check.
--   27 paid_backdate_gap — status='paid' more than 30 days after start_date.
--      Reference case: deal 000205 (ΓΑΒΡΙΗΛΙΔΗΣ ΜΠΑΝΤΑΒΑΣ) was paid_at-stamped
--      four months after its April period, invisible in the month it was
--      actually earned (repaired 2026-08-27,
--      docs/data-fixes/2026-08-27-paid-at-backdate-repair.md). 0 rows live
--      2026-08-27 (the repair already ran) — this is the standing guard so
--      that class of gap can never silently come back.
--   28 payment_missing_dates — non-cancelled rows with start_date is null.
--      19 rows live 2026-08-27 (13 pending + 6 already paid with no date).
--   29 expense_stale_pending — pending expenses whose own period ended more
--      than 60 days ago. 0 rows live 2026-08-27.
--   30 expense_zero_vat_streak — software/ads_spend/hosting_domains expenses
--      inserted in the last 7 days at 0% VAT. Doesn't fix Task 1 finding E5
--      (100% of expenses carry vat_rate=0, owner-gated) — nudges the question
--      at entry time for the three categories most likely to actually carry
--      real VAT. 6 rows live 2026-08-27 (real signal, not a planted probe).
--
-- Cron / dedupe check (per task brief): reconcile_payment_integrity() (cron.job
-- id 14, `0 4 * * *`) does NOT call accounting_integrity_alerts() — it is a
-- fully separate function with its own two hand-rolled checks
-- (duplicate_period, flip_out_of_paid_in_full) that persist into
-- data_integrity_alerts with their own NOT EXISTS dedupe. accounting_integrity_
-- alerts() is never persisted by any cron: the Accounting alerts page
-- (src/features/accounting/alerts/hooks/useIntegrityAlerts.ts) calls the RPC
-- live on every page load, and de-duplication for standing populations is
-- entirely via public.integrity_alert_dismissals (check_key + subject_id +
-- signature) — the same mechanism checks 1-25 already rely on for exactly
-- this "known but not yet fixed" shape (e.g. check 15 cash_deal_with_vat,
-- check 19 test_client_name). No re-insertion risk exists because nothing is
-- ever inserted; checks 26-30 need no new dedupe machinery.
--
-- Pre-change live md5(pg_get_functiondef):
--   accounting_integrity_alerts = b477063586f74cbfa131df06722715de
--   seed_deal_payments          = 4db6cb817cea98067b2ae71516f8c973
--   ensure_recurring_payments   = 31e16f8b236348fbc8f849ea5f96d463
-- Post-change md5 values are recorded in the deploy output / task-5-report.md.
--
-- ROLLBACK:
--   drop function public.deal_vat_rate(uuid);
--   Re-apply seed_deal_payments/ensure_recurring_payments from
--     20260826150000_cash_vat_payment_seeding.sql (restores the inline CASE).
--   Re-apply accounting_integrity_alerts from
--     20260806170000_invisible_card_alert.sql (drops checks 26-30).
-- =============================================================================

-- Step 1: the single VAT rule.
CREATE OR REPLACE FUNCTION public.deal_vat_rate(p_deal_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    else public.vat_rate_for_country(c.country) end
  from public.deals d join public.clients c on c.id = d.client_id
  where d.id = p_deal_id;
$$;

-- seed_deal_payments: pure refactor — the inline CASE was already identical
-- to deal_vat_rate. Base: 20260826150000_cash_vat_payment_seeding.sql.
CREATE OR REPLACE FUNCTION public.seed_deal_payments(target_deal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record; svc jsonb; idx int := 0; s_start date; s_end date;
  net numeric(12,4); setup_net numeric(12,4); vat numeric(5,2);
  bt text; st text; term text; pct numeric[]; i int;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return; end if;
  if exists (select 1 from public.deal_payments where deal_id = d.id) then return; end if;
  if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then return; end if;

  -- Task 5 (2026-08-27): the cash/country rule now lives in one place.
  vat := public.deal_vat_rate(d.id);
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

-- ensure_recurring_payments: NOT a pure refactor — see header note. Only the
-- cash-zero value is delegated to deal_vat_rate(); the copy-forward
-- else-branch (r.vat_rate) is untouched, keeping bug B3 gated as before.
-- Base: 20260826150000_cash_vat_payment_seeding.sql.
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
    -- Task 5 (2026-08-27): the 0.00 constant is now sourced from deal_vat_rate()
    -- instead of hardcoded — same value, single place of truth for what "cash
    -- zero" means; the copy-forward else-branch is unchanged.
    select case
        when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false)
          then public.deal_vat_rate(r.deal_id)
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

-- Step 2: checks 26-30 appended to accounting_integrity_alerts(). Verbatim
-- body of checks 1-25 (base 20260806170000_invisible_card_alert.sql, drift
-- checked live 2026-08-27, no changes), new UNION ALL branches inserted
-- before the closing `)` of the alerts CTE.
CREATE OR REPLACE FUNCTION public.accounting_integrity_alerts()
 RETURNS TABLE(check_key text, severity text, category text, subject_type text, subject_id uuid, subject_code text, title text, detail text, deal_id uuid, job_id uuid, signature text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    return; -- no rows for anyone else
  end if;
  return query
  with alerts (check_key, severity, category, subject_type,
               subject_id, subject_code, title, detail,
               deal_id, job_id, signature) as (
    -- 1 deal_zero_value
    select 'deal_zero_value'::text, 'amber'::text, 'money'::text, 'deal'::text,
           d.id, d.code, 'Deal has €0 total'::text,
           'One-time €0 and monthly €0'::text, d.id, null::uuid, ''::text
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(d.one_time_value,0)=0 and coalesce(d.recurring_monthly_value,0)=0
    union all
    -- 2 recurring_job_zero
    select 'recurring_job_zero','red','money','job', j.id, j.code, 'Recurring job bills €0',
           'Active recurring job with amount_net = 0', j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active and j.parent_job_id is null
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)=0
    union all
    -- 3 vat_missing (Cyprus + UAE are legit 0%-VAT countries)
    select 'vat_missing','amber','money','job', j.id, j.code, 'VAT missing (0%)',
           'Job at 0% VAT but client is not a 0%-VAT country (Cyprus/UAE) and deal is not cash-no-VAT',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id
      left join clients c on c.id=d.client_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)=0
       and not coalesce(d.payment_method='cash' and not coalesce(d.cash_charge_vat,false), false)
       and coalesce(c.country,'') not ilike 'cyprus'
       and coalesce(c.country,'') not ilike 'united arab emirates'
    union all
    -- 4 vat_odd_rate
    select 'vat_odd_rate','grey','money','job', j.id, j.code, 'Unusual VAT rate',
           'VAT rate = '||j.vat_rate::text||'% (not 0 or 24)', j.deal_id, j.id, j.vat_rate::text
      from jobs j where not j.archived and j.vat_rate is not null and j.vat_rate not in (0,24)
    union all
    -- 5 aiseo_child_amount
    select 'aiseo_child_amount','red','money','job', j.id, j.code, 'AI-SEO child carries an amount',
           'Child job has a non-zero amount (should bill on the parent)', j.deal_id, j.id, ''
      from jobs j where not j.archived and j.parent_job_id is not null
       and (coalesce(j.amount_net,0)>0 or coalesce(j.monthly_amount,0)>0 or coalesce(j.one_time_amount,0)>0)
    union all
    -- 6 duplicate_period
    select 'duplicate_period','red','lifecycle','deal', dp.deal_id,
           (select code from deals where id=dp.deal_id),
           'Duplicate billing period',
           coalesce(dp.service_type,'?')||' '||dp.start_date::text||'→'||dp.end_date::text||' billed '||count(*)::text||'×',
           dp.deal_id, null::uuid, dp.service_type||':'||dp.start_date::text||':'||dp.end_date::text
      from deal_payments dp
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.start_date is not null and dp.end_date is not null and dp.status<>'cancelled'
     group by dp.deal_id, dp.service_type, dp.billing_type, dp.start_date, dp.end_date
     having count(*)>=2
    union all
    -- 7 paid_in_full_but_owes
    select 'paid_in_full_but_owes','red','lifecycle','deal', d.id, d.code,
           'Marked Paid In Full but still owes', 'Has an unpaid payment already past due', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='paid_in_full'
       and exists (select 1 from deal_payments p where p.deal_id=d.id
                    and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 8 on_hold_not_overdue
    select 'on_hold_not_overdue','amber','lifecycle','deal', d.id, d.code,
           'On Hold but nothing overdue', 'Held with no past-due unpaid payment', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='on_hold'
       and not exists (select 1 from deal_payments p where p.deal_id=d.id
                        and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 9 stale_block
    select 'stale_block','amber','lifecycle','job', j.id, j.code, 'Stale "account on hold" block',
           'Job blocked account_on_hold but its deal is not on hold', j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.is_blocked and j.blocked_reason='account_on_hold' and ps.code<>'on_hold'
    union all
    -- 10 renewal_past_due
    select 'renewal_past_due','grey','lifecycle','job', j.id, j.code, 'Renewal past due date',
           'Renewal job due '||j.period_due_date::text, j.deal_id, j.id, j.period_due_date::text
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and s.code='renewal' and j.period_due_date is not null and j.period_due_date < current_date
    union all
    -- 11 billing_gap: recurring billing has STALLED — no period covers today.
    select 'billing_gap','red','lifecycle','deal', d.id, d.code, 'Recurring billing has stalled',
           'No billing period covers today (schedule lapsed)', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done','on_hold')
       and exists (select 1 from jobs j where j.deal_id=d.id and j.billing_active and not j.archived
                    and j.billing_type in ('recurring_monthly','recurring_yearly'))
       and not exists (select 1 from deal_payments p where p.deal_id=d.id and p.status<>'cancelled'
                        and p.start_date <= current_date and p.end_date >= current_date)
    union all
    -- 12 no_payment_method
    select 'no_payment_method','amber','missing','deal', d.id, d.code, 'No payment method',
           'Deal has no payment method set', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and nullif(trim(coalesce(d.payment_method,'')),'') is null
    union all
    -- 13 bad_email
    select 'bad_email','amber','missing','client', c.id, coalesce(c.code, left(c.id::text,8)), 'Bad or missing client email',
           coalesce(c.email,'(empty)'), null::uuid, null::uuid, coalesce(c.email,'')
      from clients c
     where not c.archived and coalesce(c.status,'') <> 'done'
       and (c.email is null or trim(c.email)='' or c.email like '% - %'
            or c.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    union all
    -- 14 won_deal_no_services
    select 'won_deal_no_services','amber','missing','deal', d.id, d.code, 'Won deal with no services',
           'No services planned and no jobs', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(jsonb_array_length(d.services_planned),0)=0
       and not exists (select 1 from jobs j where j.deal_id=d.id and not j.archived)
    union all
    -- 15 cash_deal_with_vat: deal chose cash + no-VAT, yet a job still charges VAT
    select 'cash_deal_with_vat','amber','possible_mistakes','job', j.id, j.code,
           'Cash deal but VAT charged',
           'Deal is cash + no-VAT, but this job has VAT '||j.vat_rate::text||'%',
           j.deal_id, j.id, j.vat_rate::text
      from jobs j join deals d on d.id=j.deal_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)>0
       and d.payment_method='cash' and not coalesce(d.cash_charge_vat,false)
    union all
    -- 16 duplicate_vat_number: two+ active clients share a VAT number
    select 'duplicate_vat_number','amber','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Duplicate VAT number', 'VAT '||c.vat_number||' is shared by another client',
           null::uuid, null::uuid, c.vat_number
      from clients c
     where not c.archived and nullif(trim(coalesce(c.vat_number,'')),'') is not null
       and exists (select 1 from clients c2 where c2.id<>c.id and not c2.archived
                    and trim(coalesce(c2.vat_number,''))=trim(c.vat_number))
    union all
    -- 17 deal_value_mismatch: deal's monthly value != sum of its recurring job amounts
    select 'deal_value_mismatch','grey','possible_mistakes','deal', d.id, d.code,
           'Deal value differs from its jobs',
           'Monthly value E'||coalesce(d.recurring_monthly_value,0)::text||' vs jobs E'||js.jobsum::text,
           d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
      join lateral (select coalesce(sum(j.amount_net),0) as jobsum from jobs j
                     where j.deal_id=d.id and not j.archived and j.billing_active
                       and j.billing_type in ('recurring_monthly','recurring_yearly')) js on true
     where not d.archived and ps.code not in ('closed','done')
       and js.jobsum>0 and coalesce(d.recurring_monthly_value,0)>0
       and abs(coalesce(d.recurring_monthly_value,0)-js.jobsum)>=1
    union all
    -- 18 large_recurring_amount: an unusually large recurring amount (possible typo)
    select 'large_recurring_amount','grey','possible_mistakes','job', j.id, j.code,
           'Unusually large recurring amount', 'Recurring E'||j.amount_net::text||' / period',
           j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)>3000
    union all
    -- 19 test_client_name: client name looks like a test/placeholder
    select 'test_client_name','grey','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Test-looking client name', 'Client name: '||c.name, null::uuid, null::uuid, ''
      from clients c
     where not c.archived and coalesce(c.status,'')<>'done'
       and (c.name ilike '%test%' or c.name ilike '%δοκιμ%' or c.name ilike '%asdf%'
            or c.name ilike '%xxx%' or c.name ilike '%qwerty%')
    union all
    -- 20 off_board_job: active service job on a Paid-In-Full deal with no board stage
    select 'off_board_job','red','lifecycle','job', j.id, j.code, 'Job not on its board',
           'Active job on a Paid-In-Full deal has no board stage (off-board)',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.status='active' and coalesce(j.billing_only,false)=false
       and j.stage_id is null and ps.code='paid_in_full'
       and j.service_type in ('local_seo','web_seo','web_dev','social_media','hosting','ads','maintenance','franchise','domains')
    union all
    -- 21 seo_renewal_pending: a PAID cycle the card was never renewed for.
    --     Mirrors seo_sync_renewal_job's guard (20260804090000). Normally empty —
    --     the move is automatic — so a row here means the move itself failed.
    select 'seo_renewal_pending','red','lifecycle','job', j.id, j.code,
           'Paid cycle not sent to Renewal',
           'Period from '||j.period_start_date::text||' is paid but the card sits in '||
             coalesce(s.code,'?')||' (last renewed for '||
             coalesce(j.renewed_for_period::text,'never')||')',
           j.deal_id, j.id, j.period_start_date::text
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and not s.is_terminal and s.code <> 'renewal'
       and j.service_type in ('web_seo','local_seo')
       and j.onboarded_at is not null
       and j.period_start_date is not null
       and j.period_start_date > coalesce(j.renewed_for_period,
                                          (j.onboarded_at + interval '14 days')::date)
    union all
    -- 22 seo_job_no_period: client has paid on this deal, job has no period at all.
    --     recompute_job_period_dates matches on service_type AND billing_type, so a
    --     mis-keyed payment leaves the job dateless and every guard downstream
    --     (renewal, due chips, reminders) silently no-ops.
    --     Live cards only: on a terminal lane the missing period is history, not a
    --     defect (6 of the 14 matches on 2026-08-04 were closed engagements).
    select 'seo_job_no_period','red','lifecycle','job', j.id, j.code,
           'Paid deal but job has no billing period',
           'No paid payment matches this job on service type + billing type',
           j.deal_id, j.id, ''
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and j.period_start_date is null
       and not s.is_terminal and j.status='active'
       and j.service_type in ('web_seo','local_seo')
       and j.onboarded_at is not null
       and exists (select 1 from deal_payments p
                    where p.deal_id=j.deal_id and p.status='paid')
    union all
    -- 23 paid_period_no_job: the same defect seen from the payment side.
    select 'paid_period_no_job','amber','lifecycle','deal', p.deal_id,
           (select code from deals where id=p.deal_id),
           'Paid period matches no job',
           'Paid '||coalesce(p.service_type,'(no service)')||' '||
             coalesce(p.start_date::text,'?')||' has no live job of that service on the deal',
           p.deal_id, null::uuid,
           coalesce(p.service_type,'')||':'||coalesce(p.start_date::text,'')
      from deal_payments p join deals d on d.id=p.deal_id
     where p.status='paid' and not d.archived and p.service_type is not null
       and not exists (select 1 from jobs j
                        where j.deal_id=p.deal_id and not j.archived
                          and j.service_type=p.service_type)
       and not exists (select 1 from deal_payment_lines l where l.payment_id=p.id)
    union all
    -- 24 service_card_not_billing: a live card whose service nobody bills.
    --     ensure_recurring_payments() only extends a period when a NON-archived,
    --     billing_active job of the same service_type + billing_type exists, so
    --     clearing billing_active on the last such job stops the schedule for
    --     ever — silently, because billing_gap (check 11) needs a billing_active
    --     recurring job to fire at all. Deal 000403 ran two months this way.
    --     Exclusions, each measured on prod 2026-08-04 (131 -> 10 rows):
    --       parent_job_id / billing_only  AI-SEO trio children bill on the parent (-96)
    --       ai_seo parent on the deal     same structure, seen from the child (-2)
    --       amount_net = 0                bundled or free, nothing to bill (-2)
    --       deal stage closed/done        finished engagement, stale card (-20)
    --       status <> 'active'            the team ended the work (-1)
    select 'service_card_not_billing','red','lifecycle','job', j.id, j.code,
           'Live service card with no active billing',
           'Card is live and bills EUR '||j.amount_net::text||'/period, but no '||
             'billing_active recurring job covers '||j.service_type||' on this deal',
           j.deal_id, j.id, ''
      from jobs j
      join pipeline_stages s on s.id = j.stage_id
      join deals d on d.id = j.deal_id
      join pipeline_stages ps on ps.id = d.accounting_stage_id
     where not j.archived and not d.archived and not s.is_terminal
       and ps.code not in ('closed','done')
       and j.status = 'active'
       and j.service_type in ('web_seo','local_seo','ads','social_media','maintenance')
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and not j.billing_active
       and j.parent_job_id is null
       and not coalesce(j.billing_only, false)
       and coalesce(j.amount_net, 0) > 0
       and not exists (select 1 from jobs j2
                        where j2.deal_id = j.deal_id and not j2.archived
                          and j2.service_type = j.service_type and j2.billing_active)
       and not exists (select 1 from jobs p
                        where p.deal_id = j.deal_id and not p.archived
                          and p.billing_active and p.service_type = 'ai_seo')
    union all
    -- 25 invisible_card: a live card that has a stage but renders in NO column.
    --     The kanban builds its columns from the board's NON-ARCHIVED stages
    --     (src/features/jobs/JobsKanbanPage.tsx:114) and groupJobsForBoard drops
    --     any card whose stage code has no matching column with a bare
    --     `if (!col) continue` (src/features/jobs/kanbanGrouping.ts:82). The card
    --     exists, is not archived, is not blocked, has a stage — and is visible
    --     nowhere. Deal 006122 sat like this for three days after a convert put
    --     its Web SEO card on the archived web_seo/onboarding stage, and nothing
    --     in the product could say why the team had no card to work on.
    --     Distinct from check 20 off_board_job, which catches stage_id IS NULL.
    --     Not raised when the card is blocked on a board that renders a virtual
    --     Blocked column (local_seo, web_seo, social_media, ads, maintenance,
    --     franchise, and ai_seo via those two SEO boards): kanbanGrouping diverts
    --     blocked cards there BEFORE the column lookup, so they stay visible.
    --     signature = the stage id, so dismissing one broken stage does not hide
    --     the card if it later lands on a different broken stage.
    select 'invisible_card','red','lifecycle','job', j.id, j.code,
           'Card is live but invisible on its board',
           'Job sits on '||s.board||'/'||s.code||
             case when s.archived then ' (archived stage)' else ' (stage belongs to another board)' end||
             ', so the '||j.service_type||' kanban renders no column for it',
           j.deal_id, j.id, s.id::text
      from jobs j
      join pipeline_stages s on s.id = j.stage_id
      join deals d on d.id = j.deal_id
      join pipeline_stages ps on ps.id = d.accounting_stage_id
     where not j.archived and not d.archived
       and ps.code not in ('closed','done')
       and not (j.is_blocked and j.service_type in
                ('local_seo','web_seo','social_media','ads','maintenance','franchise','ai_seo'))
       and not exists (
         select 1 from pipeline_stages c
          where not c.archived and c.code = s.code
            and c.board = any (case when j.service_type = 'ai_seo'
                                    then array['web_seo','local_seo']
                                    else array[j.service_type] end))
    union all
    -- 26 payment_vat_mismatch: the check A0 proved was completely missing (0 of
    --     27 broken rows were visible anywhere). Non-cancelled deal_payments
    --     rows whose vat_rate disagrees with the single VAT rule
    --     (public.deal_vat_rate). Cancelled rows are excluded — voided, no VAT
    --     will ever be collected on them.
    --     EXPECTED to fire on two known, owner-gated populations until a
    --     decision is made (visible != forgotten is the point of this check):
    --       - the A0 cash-charged-VAT rows paid before the 2026-08-26 fix
    --       - the B3 mirror bug: online deals whose vat_rate was copied forward
    --         at 0% and never corrected to the country rate (raising it now
    --         would silently re-invoice a client)
    --     signature carries both sides of the mismatch so a future edit to
    --     either value re-surfaces the row instead of hiding behind a stale
    --     dismissal recorded at the old numbers.
    select 'payment_vat_mismatch','amber','money','deal_payment', dp.id, d.code,
           'Payment VAT does not match the deal''s VAT rule',
           'VAT is '||dp.vat_rate::text||'% but deal_vat_rate() expects '||
             public.deal_vat_rate(dp.deal_id)::text||'%',
           dp.deal_id, null::uuid,
           dp.vat_rate::text||'->'||coalesce(public.deal_vat_rate(dp.deal_id)::text,'?')
      from deal_payments dp join deals d on d.id=dp.deal_id
     where dp.status<>'cancelled'
       and dp.vat_rate is distinct from public.deal_vat_rate(dp.deal_id)
    union all
    -- 27 paid_backdate_gap: a payment marked paid more than 30 days after its
    --     own service period started. Reference case: deal 000205 (ΓΑΒΡΙΗΛΙΔΗΣ
    --     ΜΠΑΝΤΑΒΑΣ), web_dev, period started 2026-04-02, was paid around that
    --     date but paid_at was stamped 2026-08-06 — its income was invisible in
    --     April and only surfaced four months later where nobody was looking
    --     for it (repaired 2026-08-27,
    --     docs/data-fixes/2026-08-27-paid-at-backdate-repair.md). This is the
    --     standing guard so that class of gap can never silently return.
    select 'paid_backdate_gap','red','lifecycle','deal_payment', dp.id, d.code,
           'Paid long after the period started',
           'Marked paid on '||dp.paid_at::date::text||' for a period starting '||
             dp.start_date::text||' ('||(dp.paid_at::date - dp.start_date)::text||' days)',
           dp.deal_id, null::uuid, dp.paid_at::date::text
      from deal_payments dp join deals d on d.id=dp.deal_id
     where dp.status='paid' and dp.paid_at::date > dp.start_date + 30
    union all
    -- 28 payment_missing_dates: a live (non-cancelled) payment row with no
    --     start_date. Every date-driven guard downstream (renewal, due chips,
    --     reminders, check 27 above) silently no-ops on a dateless row, so it
    --     needs its own daily surface until fixed.
    select 'payment_missing_dates','amber','missing','deal_payment', dp.id, d.code,
           'Payment has no start date',
           coalesce(nullif(dp.service_type,''),'(no service)')||' '||dp.status||' payment has start_date = NULL',
           dp.deal_id, null::uuid, ''
      from deal_payments dp join deals d on d.id=dp.deal_id
     where dp.status<>'cancelled' and dp.start_date is null
    union all
    -- 29 expense_stale_pending: an expense still "pending" more than 60 days
    --     after its own period ended — either it was actually paid and nobody
    --     flipped the status, or it is genuinely unpaid and two months overdue.
    --     Either way it needs a human, not a nightly no-op.
    select 'expense_stale_pending','amber','lifecycle','expense', e.id,
           coalesce(e.vendor, left(e.id::text,8)), 'Expense pending long after it ended',
           coalesce(e.vendor,'(no vendor)')||' ended '||e.end_date::text||' and is still pending',
           null::uuid, null::uuid, ''
      from expenses e
     where e.status='pending' and e.end_date < current_date - 60
    union all
    -- 30 expense_zero_vat_streak: a software/ads_spend/hosting_domains expense
    --     entered in the last 7 days at 0% VAT. Task 1 finding E5 found 100% of
    --     expenses carry vat_rate=0 (owner-gated, unresolved) — this does not
    --     fix that, it nudges the question at the moment of entry for the three
    --     categories most likely to actually carry real VAT, instead of letting
    --     the backlog grow unnoticed.
    select 'expense_zero_vat_streak','grey','possible_mistakes','expense', e.id,
           coalesce(e.vendor, left(e.id::text,8)), 'New expense at 0% VAT',
           coalesce(e.vendor,'(no vendor)')||' ('||ec.key||') entered at 0% VAT — confirm that''s correct',
           null::uuid, null::uuid, ''
      from expenses e join expense_categories ec on ec.id=e.category_id
     where e.created_at >= now() - interval '7 days'
       and coalesce(e.vat_rate,0)=0
       and ec.key in ('software','ads_spend','hosting_domains')
  )
  select a.* from alerts a
   where not exists (
     select 1 from public.integrity_alert_dismissals x
      where x.check_key=a.check_key and x.subject_id=a.subject_id and x.signature=coalesce(a.signature,''))
   order by case a.severity when 'red' then 0 when 'amber' then 1 else 2 end, a.category, a.subject_code;
end $function$;
