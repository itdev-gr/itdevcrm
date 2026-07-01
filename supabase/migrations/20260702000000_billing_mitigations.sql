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

-- ---- Section 4: cleanup remaining live dupes + UNIQUE partial index --
-- Prerequisite: resolve 2 remaining duplicate period-keys on deal 000415
-- (57628db6-26dc-4bb1-b94f-2897dd67e87f), service local_seo:
--   Cluster A: paid + paid for 2026-05-28 → 2026-06-28
--   Cluster B: overdue + overdue for 2026-06-28 → 2026-07-28
-- Keep the OLDEST row of each cluster; back up + delete the newer.

-- Backup remaining live duplicates before delete (idempotent).
-- Backup table has 16 cols; deal_payments has generated vat_amount/amount_gross that must be excluded.
insert into public.deal_payments_flipflop_backup_20260701
  (id, deal_id, service_type, service_index, billing_type, label, amount,
   start_date, end_date, status, invoice_number, paid_at, created_at, updated_at,
   amount_net, vat_rate)
select dp.id, dp.deal_id, dp.service_type, dp.service_index, dp.billing_type, dp.label, dp.amount,
       dp.start_date, dp.end_date, dp.status, dp.invoice_number, dp.paid_at, dp.created_at, dp.updated_at,
       dp.amount_net, dp.vat_rate
  from public.deal_payments dp
 where (dp.deal_id, dp.service_type, dp.billing_type, dp.start_date, dp.end_date) in (
   select deal_id, service_type, billing_type, start_date, end_date
     from public.deal_payments
    where billing_type in ('recurring_monthly','recurring_yearly')
      and start_date is not null and end_date is not null
    group by deal_id, service_type, billing_type, start_date, end_date
   having count(*) >= 2
 )
   and not exists (
     select 1 from public.deal_payments_flipflop_backup_20260701 b
      where b.id = dp.id
   );

-- Delete the newer row(s) of each duplicate cluster (keep the oldest).
with dup as (
  select deal_id, service_type, billing_type, start_date, end_date,
    array_agg(id order by created_at) as ids
  from public.deal_payments
  where billing_type in ('recurring_monthly','recurring_yearly')
    and start_date is not null and end_date is not null
  group by deal_id, service_type, billing_type, start_date, end_date
  having count(*) >= 2
),
to_delete as (
  select unnest(ids[2:array_length(ids, 1)]) as id from dup
)
delete from public.deal_payment_lines dpl
 where dpl.payment_id in (select id from to_delete);

with dup as (
  select deal_id, service_type, billing_type, start_date, end_date,
    array_agg(id order by created_at) as ids
  from public.deal_payments
  where billing_type in ('recurring_monthly','recurring_yearly')
    and start_date is not null and end_date is not null
  group by deal_id, service_type, billing_type, start_date, end_date
  having count(*) >= 2
),
to_delete as (
  select unnest(ids[2:array_length(ids, 1)]) as id from dup
)
delete from public.deal_payments dp
 where dp.id in (select id from to_delete);

-- Resolve the corresponding data_integrity_alerts.
update public.data_integrity_alerts
   set resolved_at = now()
 where kind = 'duplicate_period' and resolved_at is null;

-- Now safe to create the UNIQUE partial index on recurring period-keys.
create unique index if not exists deal_payments_recurring_period_key_unique
  on public.deal_payments (deal_id, service_type, billing_type, start_date, end_date)
  where billing_type in ('recurring_monthly','recurring_yearly')
    and start_date is not null and end_date is not null;

-- ---- Section 5: created_at UPDATE guard ------------------------------
-- L3's 24h grace uses created_at. Protect it against UPDATE-based bypass.
-- Trigger silently reverts changes (returns NEW with created_at := old);
-- other columns UPDATE normally.
create or replace function public.deal_payments_created_at_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.created_at is distinct from old.created_at then
    new.created_at := old.created_at;
  end if;
  return new;
end $function$;

drop trigger if exists deal_payments_created_at_immutable on public.deal_payments;
create trigger deal_payments_created_at_immutable
  before update on public.deal_payments
  for each row execute function public.deal_payments_created_at_immutable();


-- =========================================================================
-- Section 8: REVERT SQL (documentation only — do NOT run automatically)
-- =========================================================================
-- To roll back this migration, run the following in order. All statements
-- are idempotent; re-running is safe.
--
-- Step 1: Drop new trigger + function from S5 (created_at guard).
--   drop trigger if exists deal_payments_created_at_immutable on public.deal_payments;
--   drop function if exists public.deal_payments_created_at_immutable();
--
-- Step 2: Drop UNIQUE partial index from S4.
--   drop index if exists public.deal_payments_recurring_period_key_unique;
--
-- Step 3: Restore the 2 deleted duplicate rows from backup (S4 cleanup).
--   -- Use explicit column list (deal_payments has generated columns
--   -- vat_amount/amount_gross not in the backup).
--   insert into public.deal_payments
--     (id, deal_id, service_type, service_index, billing_type, label,
--      amount, start_date, end_date, status, invoice_number, paid_at,
--      created_at, updated_at, amount_net, vat_rate)
--   select id, deal_id, service_type, service_index, billing_type, label,
--          amount, start_date, end_date, status, invoice_number, paid_at,
--          created_at, updated_at, amount_net, vat_rate
--     from public.deal_payments_flipflop_backup_20260701
--    where id in (
--      '983b922e-406e-4ca8-8cdd-ad4b812619cf',  -- Cluster A newer paid
--      'd267cecc-eaf1-460c-9390-c7e3d0516139'   -- Cluster B newer overdue
--    )
--    on conflict (id) do nothing;
--
-- Step 4: Re-open the resolved data_integrity_alerts.
--   update public.data_integrity_alerts
--      set resolved_at = null
--    where kind = 'duplicate_period';  -- adjust if other kinds were resolved concurrently
--
-- Step 5: Restore prior ensure_recurring_payments body (before S1+S2+S6).
--   -- Verbatim from prod pg_get_functiondef 2026-07-02 pre-migration.
--   CREATE OR REPLACE FUNCTION public.ensure_recurring_payments()
--    RETURNS integer
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   declare
--     r record; next_start date; next_end date; created int := 0; v_payment_id uuid;
--   begin
--     perform pg_advisory_xact_lock(hashtext('ensure_recurring_payments')::bigint);
--     for r in
--       select dp.*
--         from public.deal_payments dp
--         join public.deals d on d.id = dp.deal_id
--        where dp.billing_type in ('recurring_monthly','recurring_yearly')
--          and dp.end_date is not null
--          and dp.end_date <= current_date + interval '7 days'
--          and d.archived = false
--          and coalesce((select ps.code from public.pipeline_stages ps
--                         where ps.id = d.accounting_stage_id), '') <> 'closed'
--          and (
--               not exists (select 1 from public.jobs j
--                            where j.deal_id = dp.deal_id and j.service_type = dp.service_type
--                              and not j.archived)
--            or exists (select 1 from public.jobs j
--                            where j.deal_id = dp.deal_id and j.service_type = dp.service_type
--                              and not j.archived and j.billing_active)
--          )
--          and not exists (
--            select 1 from public.deal_payments dp2
--             where dp2.deal_id = dp.deal_id
--               and dp2.service_type = dp.service_type
--               and dp2.billing_type = dp.billing_type
--               and dp2.start_date is not null
--               and dp2.start_date >= dp.end_date
--          )
--     loop
--       next_start := r.end_date;
--       if r.billing_type = 'recurring_monthly' then
--         next_end := next_start + interval '1 month';
--       else
--         next_end := next_start + interval '1 year';
--       end if;
--       insert into public.deal_payments
--         (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
--         values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount_net, r.vat_rate, next_start, next_end)
--         returning id into v_payment_id;
--       insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
--         values (v_payment_id,
--           (select j.id from public.jobs j
--             where j.deal_id = r.deal_id and j.service_type = r.service_type and not j.archived
--             order by j.created_at limit 1),
--           coalesce(r.label, r.service_type), r.amount_net, r.vat_rate);
--       created := created + 1;
--     end loop;
--     return created;
--   end $function$;
--
-- Step 6: Restore prior deal_payments_move_to_awaiting body (before S3).
--   CREATE OR REPLACE FUNCTION public.deal_payments_move_to_awaiting()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   declare awaiting_id uuid; d record; current_stage_code text;
--   begin
--     if new.billing_type = 'recurring_test_2min' then return new; end if;
--     select id into awaiting_id from public.pipeline_stages
--       where board = 'accounting_onboarding' and code = 'awaiting_payment' limit 1;
--     if awaiting_id is null then return new; end if;
--     select id, accounting_stage_id, accounting_completed_at into d
--       from public.deals where id = new.deal_id limit 1;
--     if d is null or d.accounting_completed_at is not null or d.accounting_stage_id is null
--        or d.accounting_stage_id = awaiting_id then
--       return new;
--     end if;
--     select code into current_stage_code from public.pipeline_stages where id = d.accounting_stage_id;
--     if current_stage_code in ('new','on_hold','partial_payment') then return new; end if;
--     if exists (select 1 from public.pipeline_stages ps where ps.id = d.accounting_stage_id and ps.is_terminal) then
--       return new;
--     end if;
--     update public.deals set accounting_stage_id = awaiting_id where id = new.deal_id;
--     return new;
--   end $function$;
-- =========================================================================
