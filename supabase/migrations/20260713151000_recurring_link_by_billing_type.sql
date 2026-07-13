-- 2026-07-13: Multiple same-service jobs per deal — recurring link by billing_type.
-- Plan:  docs/superpowers/plans/2026-07-13-multi-same-type-jobs.md
-- Spec:  docs/superpowers/specs/2026-07-13-multi-same-type-jobs-design.md
--
-- Companion to 20260713150000_jobs_per_type_billing.sql. When the same service
-- exists as both a one-time and a recurring job on a deal, the recurring
-- generator must (a) find its candidate by (service_type, billing_type) — not
-- service_type alone — and (b) bind the next period's line to the RECURRING job,
-- never the one-time sibling. Body copied VERBATIM from its base with exactly
-- two billing_type clauses added; the successor guard/dedupe is byte-unchanged.
--
-- Base (drift-check the live def against this before revert):
--   ensure_recurring_payments → 20260702000000_billing_mitigations.sql (Sections 1+2+6)
--
-- EDITS (only these two lines differ from the base body):
--   1. Candidate job-existence check gains `and j.billing_type = dp.billing_type`.
--   2. Successor line-link job lookup gains `and j.billing_type = r.billing_type`.
--   The successor dedupe guard (the `not exists (... deal_payments dp2 ...)`
--   block) is UNCHANGED — chain identity stays (deal_id, service_type,
--   billing_type), so the 2026-07-02 idempotency hardening is preserved intact.
--
-- ROLLBACK: re-apply 20260702000000_billing_mitigations.sql's ensure_recurring_payments
--   body verbatim (drift-check the live def first — prod bodies drift).

-- ---- ensure_recurring_payments (billing_type-scoped) --------------------
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
        coalesce(r.label, r.service_type), r.amount_net, r.vat_rate);

    created := created + 1;
  end loop;
  return created;
end $function$;
