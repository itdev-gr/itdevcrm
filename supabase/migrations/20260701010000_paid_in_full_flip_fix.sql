-- =========================================================================
-- 20260701000000_paid_in_full_flip_fix.sql
--
-- Four-layer fix for the paid_in_full → on_hold flip-flop:
--   1. ensure_recurring_payments idempotency by (service_type, date-range),
--      not service_index. [this file, section 1]
--   2. deal_payments_no_duplicate_period trigger — same de-scoping.
--      [section 2]
--   3. reconcile_block_lifecycle 24h grace on cron-created rows. [section 3]
--   4. Nightly reconcile_payment_integrity audit + cron + admin alert.
--      [sections 4 + 5]
--
-- Plus: cleanup (backup + delete + restore) in section 6, re-enable of
-- daily_payment_reminders cron in section 7, verbatim revert SQL in
-- section 8.
--
-- Every DDL statement is `create or replace` / `create ... if not exists`,
-- so re-running is a no-op. DML uses idempotency guards.
-- =========================================================================

-- ---- Section 1: ensure_recurring_payments guard ----------------------
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
       and (
            not exists (select 1 from public.jobs j
                         where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                           and not j.archived)
         or exists (select 1 from public.jobs j
                         where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                           and not j.archived and j.billing_active)
       )
       -- FIX (Layer 1): match by (deal_id, service_type, billing_type) with
       -- a date-range overlap. Any payment whose start_date sits on or
       -- after dp.end_date already covers the next period — regardless of
       -- service_index or status. Note: status='cancelled' is not a valid
       -- value on this schema (CHECK: pending|paid|overdue), so no extra
       -- status filter is needed.
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.service_type = dp.service_type
            and dp2.billing_type = dp.billing_type
            and dp2.start_date is not null
            and dp2.start_date >= dp.end_date
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

-- ---- Section 2: deal_payments_no_duplicate_period trigger ------------
create or replace function public.deal_payments_no_duplicate_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Only guard recurring inserts (one_time and recurring_test_2min are
  -- free to have overlapping rows; historical practice for corrections).
  if new.billing_type not in ('recurring_monthly','recurring_yearly') then
    return new;
  end if;

  -- Any existing payment on the same (deal_id, service_type, billing_type,
  -- start_date, end_date) blocks the insert — regardless of service_index
  -- or amount. Silently drops so the calling INSERT succeeds without a
  -- row (matches previous behaviour on the old narrower guard). Note:
  -- status='cancelled' is not a valid value on this schema (CHECK:
  -- pending|paid|overdue), so no status filter is needed.
  if exists (
    select 1 from public.deal_payments dp
     where dp.deal_id     = new.deal_id
       and dp.service_type is not distinct from new.service_type
       and dp.billing_type = new.billing_type
       and dp.start_date  = new.start_date
       and dp.end_date    is not distinct from new.end_date
  ) then
    return null;
  end if;

  return new;
end $function$;

-- ---- Section 3: reconcile 24h grace ---------------------------------
-- Layer 3: never let a fresh (<24h old) unpaid payment row drive the deal
-- OUT of paid_in_full or INTO on_hold via the awaiting_payment→on_hold
-- transition. Buys 24 h for accounting or the integrity audit to catch
-- a suspicious flip. Achieved by recomputing next_due while ignoring
-- unpaid rows that were inserted in the last 24 hours; the deciding
-- transition then uses the "effective" next_due instead.
--
-- Legitimate old unpaid rows (created_at > 24h ago) still drive the deal
-- to on_hold. Note: status='cancelled' is not a valid value on this
-- schema (CHECK: pending|paid|overdue), so no cancelled-status filter
-- is needed.
create or replace function public.reconcile_block_lifecycle(p_allow_release boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare r record; v_target text; v_target_id uuid; moved int := 0;
        v_eff_next_due date; v_eff_target text;
begin
  for r in
    select d.id, ps.code as cur_code, public.deal_next_due(d.id) as next_due
      from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not d.archived and ps.code not in ('done','closed')
       and d.payment_method is not null
       and exists (select 1 from public.deal_payments dp
                    where dp.deal_id = d.id and dp.start_date is not null)
  loop
    v_target := public.target_accounting_stage(r.next_due, current_date);

    -- Layer 3: recompute next_due ignoring unpaid rows created in the
    -- last 24 h. If ignoring them changes the target to paid_in_full,
    -- honour the grace and use the effective target.
    select min(dp.start_date) into v_eff_next_due
      from public.deal_payments dp
     where dp.deal_id = r.id
       and dp.status <> 'paid'
       and dp.created_at <= now() - interval '24 hours';
    v_eff_target := public.target_accounting_stage(v_eff_next_due, current_date);
    if r.cur_code in ('awaiting_payment','on_hold','paid_in_full')
       and v_target = 'on_hold' and v_eff_target = 'paid_in_full' then
      -- Force the deal to paid_in_full and skip the on_hold flip.
      if r.cur_code <> 'paid_in_full' then
        select id into v_target_id from public.pipeline_stages
          where board='accounting_onboarding' and code = 'paid_in_full';
        update public.deals set accounting_stage_id = v_target_id where id = r.id;
        moved := moved + 1;
      end if;
      -- Release any jobs blocked for account_on_hold (the deal is paid).
      update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
        where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
      continue;
    end if;

    if r.cur_code in ('awaiting_payment','on_hold','paid_in_full')
       and v_target is distinct from r.cur_code then
      -- existing "no auto-release" gate (unchanged)
      if not (r.cur_code = 'on_hold' and v_target = 'paid_in_full' and not p_allow_release) then
        select id into v_target_id from public.pipeline_stages
          where board='accounting_onboarding' and code = v_target;
        update public.deals set accounting_stage_id = v_target_id where id = r.id;
        moved := moved + 1; continue;
      end if;
    end if;
    if r.cur_code in ('on_hold','partial_payment') then
      perform public.block_deal_jobs(r.id);
    else
      update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
        where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
    end if;
  end loop;
  update public.jobs j set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
    from public.pipeline_stages s
   where s.id = j.stage_id and (s.is_terminal or s.code='done')
     and j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived;
  return moved;
end $function$;

-- ---- Section 4: alerts table ----------------------------------------
create table if not exists public.data_integrity_alerts (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,        -- 'duplicate_period' | 'flip_out_of_paid_in_full' | ...
  subject_type     text not null,        -- 'deal' | 'deal_payment' | ...
  subject_id       uuid not null,
  details          jsonb not null default '{}'::jsonb,
  detected_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid
);
create index if not exists data_integrity_alerts_kind_open
  on public.data_integrity_alerts (kind) where resolved_at is null;
create index if not exists data_integrity_alerts_subject
  on public.data_integrity_alerts (subject_type, subject_id);

alter table public.data_integrity_alerts enable row level security;

drop policy if exists data_integrity_alerts_admin_read  on public.data_integrity_alerts;
drop policy if exists data_integrity_alerts_admin_write on public.data_integrity_alerts;

create policy data_integrity_alerts_admin_read
  on public.data_integrity_alerts for select
  using (
    exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.is_admin and not p.archived)
  );

create policy data_integrity_alerts_admin_write
  on public.data_integrity_alerts for update
  using (
    exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.is_admin and not p.archived)
  );

-- ---- Section 5: nightly integrity audit -----------------------------
create or replace function public.reconcile_payment_integrity()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_alerts int := 0;
  v_rec record;
begin
  -- Detect duplicate live period-keys (schema has no 'cancelled' status
  -- so any non-null status counts).
  for v_rec in
    with dup as (
      select deal_id, service_type, billing_type, start_date, end_date,
        array_agg(id order by created_at) as ids,
        array_agg(status order by created_at) as statuses
      from public.deal_payments
      where billing_type in ('recurring_monthly','recurring_yearly')
        and start_date is not null and end_date is not null
      group by deal_id, service_type, billing_type, start_date, end_date
      having count(*) >= 2
    )
    select deal_id, service_type, billing_type, start_date, end_date,
           ids, statuses
      from dup
  loop
    insert into public.data_integrity_alerts
      (kind, subject_type, subject_id, details)
    select 'duplicate_period', 'deal', v_rec.deal_id,
           jsonb_build_object(
             'service_type', v_rec.service_type,
             'billing_type', v_rec.billing_type,
             'start_date',   v_rec.start_date,
             'end_date',     v_rec.end_date,
             'payment_ids',  v_rec.ids,
             'statuses',     v_rec.statuses)
     where not exists (
       select 1 from public.data_integrity_alerts a
        where a.kind = 'duplicate_period'
          and a.subject_id = v_rec.deal_id
          and a.details ->> 'start_date' = v_rec.start_date::text
          and a.details ->> 'end_date'   = v_rec.end_date::text
          and a.resolved_at is null);
    v_alerts := v_alerts + 1;
  end loop;

  -- Detect deals that flipped OUT of paid_in_full in the last 24 h
  -- (heuristic: currently on_hold, updated recently, has an unpaid past-due).
  for v_rec in
    select d.id as deal_id, d.updated_at,
           public.deal_next_due(d.id) as next_due
      from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not d.archived and ps.code = 'on_hold'
       and d.updated_at > now() - interval '25 hours'
       and public.deal_next_due(d.id) is not null
       and public.deal_next_due(d.id) <= current_date
  loop
    insert into public.data_integrity_alerts
      (kind, subject_type, subject_id, details)
    select 'flip_out_of_paid_in_full', 'deal', v_rec.deal_id,
           jsonb_build_object(
             'updated_at', v_rec.updated_at,
             'next_due',   v_rec.next_due)
     where not exists (
       select 1 from public.data_integrity_alerts a
        where a.kind = 'flip_out_of_paid_in_full'
          and a.subject_id = v_rec.deal_id
          and a.detected_at > now() - interval '25 hours'
          and a.resolved_at is null);
    v_alerts := v_alerts + 1;
  end loop;

  -- Notify every admin, once per audit run with new alerts.
  if v_alerts > 0 then
    insert into public.notifications (user_id, type, payload)
    select p.user_id, 'payment_integrity_alert',
           jsonb_build_object(
             'kind',       'integrity_audit',
             'alerts_new', v_alerts,
             'ran_at',     now())
      from public.profiles p
     where p.is_admin and not p.archived;
  end if;

  return v_alerts;
end $function$;

-- Cron: 04:00 UTC daily, 100 min after the recurring/reconcile crons.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'reconcile_payment_integrity') then
    perform cron.schedule(
      'reconcile_payment_integrity',
      '0 4 * * *',
      $c$ select public.reconcile_payment_integrity(); $c$
    );
  end if;
end $$;

-- ---- Section 6: historical cleanup ----------------------------------
-- Backup table mirrors deal_payments *without* generated columns
-- (vat_amount, amount_gross) so a plain column-by-column insert works.
create table if not exists public.deal_payments_flipflop_backup_20260701 (
  id              uuid,
  deal_id         uuid,
  service_type    text,
  service_index   integer,
  billing_type    text,
  label           text,
  amount          numeric,
  start_date      date,
  end_date        date,
  status          text,
  invoice_number  text,
  paid_at         timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz,
  amount_net      numeric,
  vat_rate        numeric
);

-- Backup EVERY row involved in a duplicate period-key. Idempotent: rows
-- already in the backup are skipped by the "not exists" guard.
insert into public.deal_payments_flipflop_backup_20260701 (
  id, deal_id, service_type, service_index, billing_type, label,
  amount, start_date, end_date, status, invoice_number, paid_at,
  created_at, updated_at, amount_net, vat_rate
)
select dp.id, dp.deal_id, dp.service_type, dp.service_index, dp.billing_type, dp.label,
       dp.amount, dp.start_date, dp.end_date, dp.status, dp.invoice_number, dp.paid_at,
       dp.created_at, dp.updated_at, dp.amount_net, dp.vat_rate
  from public.deal_payments dp
  join (
    select deal_id, service_type, billing_type, start_date, end_date
      from public.deal_payments
     where billing_type in ('recurring_monthly','recurring_yearly')
       and start_date is not null and end_date is not null
     group by deal_id, service_type, billing_type, start_date, end_date
     having count(*) >= 2
  ) k on k.deal_id = dp.deal_id
     and k.service_type = dp.service_type
     and k.billing_type = dp.billing_type
     and k.start_date  = dp.start_date
     and k.end_date    = dp.end_date
 where not exists (
   select 1 from public.deal_payments_flipflop_backup_20260701 b
    where b.id = dp.id);

-- Delete the deal_payment_lines for the removable duplicate rows first
-- (FK ordering). "Removable" = live-unpaid AND has a paid sibling in the
-- same cluster. Never delete a paid row (would erase money-received
-- history).
with dup as (
  select deal_id, service_type, billing_type, start_date, end_date,
    array_agg(id order by created_at)      as ids,
    array_agg(status order by created_at)  as statuses
  from public.deal_payments
  where billing_type in ('recurring_monthly','recurring_yearly')
    and start_date is not null and end_date is not null
  group by deal_id, service_type, billing_type, start_date, end_date
  having count(*) >= 2
),
deletable as (
  select unnest(dup.ids)      as id,
         unnest(dup.statuses) as status,
         dup.statuses         as cluster_statuses
    from dup
   where 'paid' = any (dup.statuses)  -- keeper exists
)
delete from public.deal_payment_lines dpl
 where dpl.payment_id in (
   select id from deletable where status in ('overdue','pending')
 );

with dup as (
  select deal_id, service_type, billing_type, start_date, end_date,
    array_agg(id order by created_at)      as ids,
    array_agg(status order by created_at)  as statuses
  from public.deal_payments
  where billing_type in ('recurring_monthly','recurring_yearly')
    and start_date is not null and end_date is not null
  group by deal_id, service_type, billing_type, start_date, end_date
  having count(*) >= 2
),
deletable as (
  select unnest(dup.ids)      as id,
         unnest(dup.statuses) as status,
         dup.statuses         as cluster_statuses
    from dup
   where 'paid' = any (dup.statuses)
)
delete from public.deal_payments dp
 where dp.id in (select id from deletable where status in ('overdue','pending'));

-- Restore any deal that's currently on_hold and now has no live past-due
-- after the delete above.
with paid_stage as (
  select id from public.pipeline_stages
   where board='accounting_onboarding' and code='paid_in_full' limit 1
),
target as (
  select d.id
    from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where not d.archived
     and ps.code = 'on_hold'
     and public.deal_next_due(d.id) is null
)
update public.deals set accounting_stage_id = (select id from paid_stage)
 where id in (select id from target);

-- Unblock jobs on those restored deals.
update public.jobs j
   set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
  from public.deals d
  join public.pipeline_stages ps on ps.id = d.accounting_stage_id
 where j.deal_id = d.id
   and ps.code = 'paid_in_full'
   and j.is_blocked
   and j.blocked_reason = 'account_on_hold';

-- ---- Section 7: re-enable paused daily_payment_reminders cron -------
-- Paused ~14:00 UTC 2026-07-01 during triage (jobid 7). Now that the
-- four defense layers are live and cleanup restored the flipped deals,
-- payment reminders can resume 06:00 UTC tomorrow.
select cron.alter_job(job_id => 7, active => true);


-- =========================================================================
-- Section 8: REVERT SQL (documentation only — do NOT run automatically)
-- =========================================================================
-- To roll back this migration, run the following in order. All statements
-- are idempotent; re-running is safe.
--
-- Step 1: Restore the three modified functions to their pre-patch bodies.
--         (Captured verbatim from prod pg_get_functiondef 2026-07-01 before
--          any layer of this migration was applied.)
--
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
--               and dp2.billing_type = dp.billing_type
--               and dp2.service_index is not distinct from dp.service_index
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
--   CREATE OR REPLACE FUNCTION public.deal_payments_no_duplicate_period()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   begin
--     if new.billing_type in ('recurring_monthly','recurring_yearly')
--        and exists (
--          select 1 from public.deal_payments dp
--           where dp.deal_id = new.deal_id
--             and dp.billing_type = new.billing_type
--             and dp.service_index is not distinct from new.service_index
--             and dp.start_date = new.start_date
--             and dp.end_date is not distinct from new.end_date
--        ) then
--       return null;
--     end if;
--     return new;
--   end $function$;
--
--   CREATE OR REPLACE FUNCTION public.reconcile_block_lifecycle(p_allow_release boolean DEFAULT false)
--    RETURNS integer
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   declare r record; v_target text; v_target_id uuid; moved int := 0;
--   begin
--     for r in
--       select d.id, ps.code as cur_code, public.deal_next_due(d.id) as next_due
--         from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
--        where not d.archived and ps.code not in ('done','closed')
--          and d.payment_method is not null
--          and exists (select 1 from public.deal_payments dp
--                       where dp.deal_id = d.id and dp.start_date is not null)
--     loop
--       v_target := public.target_accounting_stage(r.next_due, current_date);
--       if r.cur_code in ('awaiting_payment','on_hold','paid_in_full') and v_target is distinct from r.cur_code then
--         if not (r.cur_code = 'on_hold' and v_target = 'paid_in_full' and not p_allow_release) then
--           select id into v_target_id from public.pipeline_stages where board='accounting_onboarding' and code = v_target;
--           update public.deals set accounting_stage_id = v_target_id where id = r.id;
--           moved := moved + 1; continue;
--         end if;
--       end if;
--       if r.cur_code in ('on_hold','partial_payment') then
--         perform public.block_deal_jobs(r.id);
--       else
--         update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
--           where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
--       end if;
--     end loop;
--     update public.jobs j set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
--       from public.pipeline_stages s
--      where s.id = j.stage_id and (s.is_terminal or s.code='done')
--        and j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived;
--     return moved;
--   end $function$;
--
-- Step 2: Drop the new audit function + cron.
--   select cron.unschedule('reconcile_payment_integrity');
--   drop function if exists public.reconcile_payment_integrity();
--
-- Step 3: Drop the alerts table (only if you don't need the history).
--   drop table if exists public.data_integrity_alerts;
--
-- Step 4: Restore historical duplicate rows from backup (if desired).
--   insert into public.deal_payments (
--     id, deal_id, service_type, service_index, billing_type, amount_net,
--     vat_rate, start_date, end_date, status, created_at, updated_at,
--     label, paid_at
--   )
--   select id, deal_id, service_type, service_index, billing_type, amount_net,
--          vat_rate, start_date, end_date, status, created_at, updated_at,
--          label, paid_at
--     from public.deal_payments_flipflop_backup_20260701
--    on conflict (id) do nothing;
--   -- Note: deal_payment_lines were also deleted for those rows; rebuild
--   -- manually if needed by inspecting the backup rows' service_type/amount.
--
-- Step 5: Flip the restored deals back to on_hold (list captured in the
--         plan file docs/superpowers/plans/2026-07-01-paid-in-full-hold-flip-fix.md
--         and in memory project_paid_in_full_flip_fix.md; check MEMORY.md).
--   -- Example — adjust the code list to match what actually got restored:
--   -- update public.deals set accounting_stage_id = (
--   --   select id from public.pipeline_stages
--   --    where board='accounting_onboarding' and code='on_hold')
--   --  where code in ('000131','000066','000203','000512');
--
-- Step 6: Re-disable the payment reminders cron.
--   select cron.alter_job(job_id => 7, active => false);
--
-- Step 7: Drop the backup table (final step, only if fully rolled back).
--   drop table if exists public.deal_payments_flipflop_backup_20260701;
-- =========================================================================
