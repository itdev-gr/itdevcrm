-- =============================================================================
-- ensure_recurring_payments: ignore cancelled periods (2026-08-06)   [audit A5]
--
-- WHY. The nightly generator (cron 02:00 UTC) never looks at
-- deal_payments.status. To it, a row that was deliberately voided is an ordinary
-- row, and that matters in the two places status is missing from:
--
--   1) THE DRIVING LOOP — it picks the row to extend without checking status, so
--      a cancelled row at the head of a chain seeds the next period and copies
--      its amount. The client is billed for a period descended from one that was
--      explicitly cancelled.
--
--   2) THE SUCCESSOR GUARD — `not exists (… dp2.end_date > dp.end_date)` also
--      ignores status, so a FUTURE-DATED cancelled row satisfies "a newer row
--      already exists" and the live row beneath it is never extended. Billing
--      stops with no error, no alert and no invoice. This is the same silent-stop
--      shape deal 000403 hit; the card still reads billing_active, so check 11
--      billing_gap only notices once the last live period has already lapsed.
--
-- WHERE `cancelled` COMES FROM. Exactly one writer in the whole database:
-- job_pause_billing(), which excuses a chain's unpaid recurring rows. Nothing in
-- the payments UI produces it — the status toggle only flips paid/pending, and
-- the row delete is a hard DELETE.
--
-- WHY IT HAS NOT FIRED YET, AND WHY THAT IS NOT REASSURING. Measured live
-- 2026-08-06: 45 chains carry a cancelled row at the head, and ZERO of them have
-- a billing_active job — so the loop's unrelated `exists (billing_active job)`
-- guard skips them all. Zero successors have ever been seeded from a cancelled
-- row, and zero chains are currently blocked by one. The protection is
-- accidental: job_pause_billing sets billing_active = false AND cancels the rows
-- in the same call, so the two always travel together.
--
-- job_resume_billing() separates them. It restores billing_active = true and
-- opens a fresh period from today, but deliberately leaves the cancelled rows
-- behind ("excused — no back-billing", which is correct). After Pause → Resume a
-- chain has a live billing switch AND cancelled rows: exactly the combination
-- this defect needs. On a recurring_yearly service the cancelled row can outrank
-- the live one by months, freezing the chain for that whole span.
--
-- FIX. Two predicates, nothing else — one in the driving loop, one in the
-- successor guard. Cancelled rows become genuinely inert: they neither seed nor
-- block, and they stay visible as history.
--
-- NOT CHANGED: job_resume_billing. Leaving cancelled rows cancelled is the
-- correct "excused" semantics, and this change is what makes leaving them safe.
--
-- Pre-change live body md5(pg_get_functiondef) = b65256bd350f76387c1fb0619892e8a0
-- (read from prod 2026-08-06; matches the newest repo emission,
--  20260714090000_payment_line_amount_sync.sql — no drift.)
--
-- ROLLBACK:
--   re-apply supabase/migrations/20260714090000_payment_line_amount_sync.sql
--   (restores the pre-change body, md5 b65256bd350f76387c1fb0619892e8a0).
--
-- APPLIED to prod 2026-08-06. Post-change md5(pg_get_functiondef) =
--   931fec15e8fb8df99cf96f10b9fbc93c
--
-- VERIFIED before applying, against a real chain (deal 006313 / local_seo /
-- recurring_monthly) inside rolled-back transactions. The chain was shifted so
-- its newest period ends in 3 days, putting it in the generator's window; the
-- count is periods created for that chain:
--
--   A  baseline, no cancelled row      old fn   expect 1  ->  1   sanity
--   B  future-dated cancelled above    old fn   expect 0  ->  0   BUG reproduced
--   C  same state                      new fn   expect 1  ->  1   blocking fixed
--   D  cancelled row IS the head       old fn   expect 1  ->  1   BUG reproduced
--   E  same state                      new fn   expect 0  ->  0   seeding fixed
--
-- Both failure modes were reproduced on the live function and both are closed by
-- this one. Blast radius across the whole database, same transaction technique:
-- old fn creates 0 rows tonight, new fn creates 0 rows — identical, so no client
-- is billed, no deal moves stage and no reminder is armed as a result of this
-- change. It closes a door that is currently held shut only by the accidental
-- pairing described above.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_recurring_payments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
