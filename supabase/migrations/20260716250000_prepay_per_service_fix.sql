-- =============================================================================
-- FIX (2026-07-16): accounting_prepay_months double-billed via the nightly cron.
--
-- The original RPC (20260716220000) inserted GROUP-level periods with
-- service_type = NULL (mirroring ensure_recurring_payments_v2). But the cron
-- (cron.job 1, 02:00) runs the LEGACY per-service ensure_recurring_payments(),
-- whose successor guard is `dp2.service_type is not distinct from dp.service_type`.
-- Since `NULL is not distinct from 'local_seo'` is FALSE, the cron could not see
-- the prepaid null-typed rows as successors and RE-CREATED an overlapping UNPAID
-- period for the ending typed base period → the prepaid client got dunned /
-- On-Held. Proven with a rolled-back harness (cron added 1 pending row over
-- prepaid coverage).
--
-- Prod reality (verified): all 638 recurring deal_payments are per-service
-- (service_type set); ZERO multi-job recurring_monthly billing groups exist. So
-- the correct, consistent model is PER-SERVICE rows — exactly what the cron and
-- 100% of existing data use. This RPC now emits one paid period per JOB with
-- that job's service_type + service_index, chained from the job's current
-- horizon. GREEN harness: after prepay, the cron adds 0 rows, 0 unpaid.
--
-- Bonus: setting service_type also fixes the ledger mis-categorization (revenue
-- no longer NULL/`deal_payments_default_service_keys`-derived from a €0 job).
--
-- Result JSON shape is UNCHANGED (groups[].{group_key,services[],monthly_net,
-- from,to,created} + ok/dry_run/months/periods_created/skipped_duplicates), so
-- the PrepayDialog needs no change.
--
-- ROLLBACK: restore the body from 20260716220000_accounting_prepay_months.sql
-- (but that reintroduces the double-bill — do not).
-- =============================================================================

create or replace function public.accounting_prepay_months(
  p_deal_id uuid,
  p_months int,
  p_dry_run boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  jobrec record;
  v_months int;
  v_payment_id uuid;
  v_start date;
  v_end date;
  v_created int := 0;
  v_skipped int := 0;
  v_job_created int;
  v_groups jsonb := '[]'::jsonb;
  v_cur_end date;
  v_svc_index int;
  i int;
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  v_months := least(greatest(coalesce(p_months, 0), 1), 12);

  -- One chain per JOB (all recurring_monthly groups in prod are solo). Emitting
  -- typed rows keeps the legacy cron's per-service successor guard working.
  for jobrec in
    select j.id as job_id, j.service_type, j.amount_net, j.vat_rate, j.title
      from public.jobs j
     where j.deal_id = p_deal_id and j.billing_active and not j.archived
       and j.billing_type = 'recurring_monthly'
  loop
    -- current horizon = latest linked recurring_monthly period for this job
    select max(p.end_date) into v_cur_end
      from public.deal_payment_lines l
      join public.deal_payments p on p.id = l.payment_id and p.billing_type = 'recurring_monthly'
     where l.job_id = jobrec.job_id;

    if v_cur_end is null then
      v_groups := v_groups || jsonb_build_object(
        'group_key', 'job:' || jobrec.job_id,
        'services', jsonb_build_array(jobrec.service_type),
        'monthly_net', coalesce(jobrec.amount_net, 0),
        'error', 'no_base_period', 'created', 0);
      continue;
    end if;

    -- keep the same service_index as the job's existing typed periods
    select coalesce(max(p.service_index), 0) into v_svc_index
      from public.deal_payment_lines l
      join public.deal_payments p on p.id = l.payment_id and p.billing_type = 'recurring_monthly'
     where l.job_id = jobrec.job_id and p.service_type = jobrec.service_type;

    v_start := v_cur_end;
    v_job_created := 0;

    for i in 1..v_months loop
      v_end := (v_start + interval '1 month')::date;
      if not p_dry_run then
        v_payment_id := null;
        insert into public.deal_payments
          (deal_id, service_type, service_index, billing_type, start_date, end_date, status, paid_at, amount_net, vat_rate)
        values
          (p_deal_id, jobrec.service_type, v_svc_index, 'recurring_monthly', v_start, v_end, 'paid', now(),
           coalesce(jobrec.amount_net, 0), coalesce(jobrec.vat_rate, 24))
        returning id into v_payment_id;

        if v_payment_id is null then
          -- duplicate-period trigger suppressed the row; chain still advances
          v_skipped := v_skipped + 1;
        else
          insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
          values (v_payment_id, jobrec.job_id,
                  coalesce(nullif(jobrec.title, ''), jobrec.service_type),
                  coalesce(jobrec.amount_net, 0), coalesce(jobrec.vat_rate, 24));
          update public.deal_payments p set
            amount_net = coalesce((select sum(amount_net) from public.deal_payment_lines where payment_id = p.id), 0),
            vat_rate   = coalesce((select max(vat_rate)  from public.deal_payment_lines where payment_id = p.id), 24)
           where p.id = v_payment_id;
          v_created := v_created + 1;
          v_job_created := v_job_created + 1;
        end if;
      end if;
      v_start := v_end;
    end loop;

    v_groups := v_groups || jsonb_build_object(
      'group_key', 'job:' || jobrec.job_id,
      'services', jsonb_build_array(jobrec.service_type),
      'monthly_net', coalesce(jobrec.amount_net, 0),
      'from', v_cur_end, 'to', v_start,
      'created', case when p_dry_run then v_months else v_job_created end);
  end loop;

  if jsonb_array_length(v_groups) = 0 then
    return jsonb_build_object('ok', false, 'errors', array['no_monthly_chain']);
  end if;

  return jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'months', v_months,
    'periods_created', v_created, 'skipped_duplicates', v_skipped,
    'groups', v_groups);
end $$;

revoke execute on function public.accounting_prepay_months(uuid, int, boolean) from public, anon;
grant execute on function public.accounting_prepay_months(uuid, int, boolean) to authenticated;

-- Post-assert: body must be per-service (no null-typed group inserts).
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'accounting_prepay_months'
       and p.prosrc like '%null, ''recurring_monthly''%'
  ) then
    raise exception 'accounting_prepay_months still inserts null service_type';
  end if;
end $$;