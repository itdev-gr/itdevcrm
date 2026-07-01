-- =========================================================================
-- 20260702100000_job_billing_pause.sql
-- Per-job (chain-scoped) billing pause for accounting.
--   S1: add 'cancelled' to deal_payments.status CHECK
--   S2: swap UNIQUE partial index to exclude cancelled rows
--   S3: thread status <> 'cancelled' through the 6 state-machine functions
--   S4: job_pause_billing / job_resume_billing RPCs
--   S5 (bottom): revert SQL
-- =========================================================================

-- ---- Section 1: status CHECK gains 'cancelled' ------------------------
alter table public.deal_payments
  drop constraint if exists deal_payments_status_check;
alter table public.deal_payments
  add constraint deal_payments_status_check
  check (status = any (array['pending'::text,'paid'::text,'overdue'::text,'cancelled'::text]));

-- ---- Section 2: UNIQUE index excludes cancelled ------------------------
-- Cancelled rows leave the index, freeing the period-key so resume /
-- manual re-billing of a paused period cannot hit unique_violation.
create unique index if not exists deal_payments_recurring_period_key_unique_v2
  on public.deal_payments (deal_id, service_type, billing_type, start_date, end_date)
  where billing_type in ('recurring_monthly','recurring_yearly')
    and start_date is not null and end_date is not null
    and status <> 'cancelled';
drop index if exists public.deal_payments_recurring_period_key_unique;

-- ---- Section 3: cancelled rows are invisible to the state machine -------
-- Threads `status <> 'cancelled'` through the 6 state-machine functions so
-- excused (cancelled) payment rows are ignored by the billing state machine
-- but preserved in history. Bodies below = deployed prod snapshot (captured
-- 2026-07-02) with only the marked edits applied.

create or replace function public.deal_next_due(p_deal_id uuid)
returns date language sql stable set search_path = public as $$
  select min(dp.start_date) from public.deal_payments dp
   where dp.deal_id = p_deal_id
     and dp.status <> 'paid'
     and dp.status <> 'cancelled';
$$;

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
       and dp.status <> 'cancelled'
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
            and dp2.status <> 'cancelled'
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
end $function$
;

CREATE OR REPLACE FUNCTION public.deal_payments_no_duplicate_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Only guard recurring inserts (one_time and recurring_test_2min are
  -- free to have overlapping rows; historical practice for corrections).
  if new.billing_type not in ('recurring_monthly','recurring_yearly') then
    return new;
  end if;

  -- Any existing payment on the same (deal_id, service_type, billing_type,
  -- start_date, end_date) blocks the insert — regardless of service_index
  -- or amount. Silently drops so the calling INSERT succeeds without a
  -- row (matches previous behaviour on the old narrower guard).
  -- Cancelled (excused) rows do not block a re-insert of the same period.
  if exists (
    select 1 from public.deal_payments dp
     where dp.deal_id     = new.deal_id
       and dp.service_type is not distinct from new.service_type
       and dp.billing_type = new.billing_type
       and dp.start_date  = new.start_date
       and dp.end_date    is not distinct from new.end_date
       and dp.status <> 'cancelled'
  ) then
    return null;
  end if;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.deal_payments_release_from_on_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cur_code text; paid_stage_id uuid; has_pm boolean;
begin
  if new.status <> 'paid' or old.status is not distinct from 'paid' then return new; end if;

  select ps.code, (d.payment_method is not null) into cur_code, has_pm
    from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where d.id = new.deal_id;
  if cur_code is null or cur_code not in ('on_hold','partial_payment') or not has_pm then
    return new;
  end if;

  if exists (select 1 from public.deal_payments dp
              where dp.deal_id = new.deal_id
                and dp.status not in ('paid','cancelled')
                and dp.start_date is not null and dp.start_date <= current_date) then
    return new;
  end if;

  select id into paid_stage_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;
  if paid_stage_id is null then return new; end if;
  update public.deals set accounting_stage_id = paid_stage_id where id = new.deal_id;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.reconcile_block_lifecycle(p_allow_release boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    select min(dp.start_date) into v_eff_next_due
      from public.deal_payments dp
     where dp.deal_id = r.id
       and dp.status <> 'paid'
       and dp.status <> 'cancelled'
       and dp.created_at <= now() - interval '24 hours';
    v_eff_target := public.target_accounting_stage(v_eff_next_due, current_date);
    if r.cur_code in ('awaiting_payment','on_hold','paid_in_full')
       and v_target = 'on_hold' and v_eff_target = 'paid_in_full' then
      if r.cur_code <> 'paid_in_full' then
        select id into v_target_id from public.pipeline_stages
          where board='accounting_onboarding' and code = 'paid_in_full';
        update public.deals set accounting_stage_id = v_target_id where id = r.id;
        moved := moved + 1;
      end if;
      update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
        where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
      continue;
    end if;

    if r.cur_code in ('awaiting_payment','on_hold','paid_in_full')
       and v_target is distinct from r.cur_code then
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
end $function$
;

CREATE OR REPLACE FUNCTION public.reconcile_payment_integrity()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alerts int := 0;
  v_rec record;
begin
  for v_rec in
    with dup as (
      select deal_id, service_type, billing_type, start_date, end_date,
        array_agg(id order by created_at) as ids,
        array_agg(status order by created_at) as statuses
      from public.deal_payments
      where billing_type in ('recurring_monthly','recurring_yearly')
        and start_date is not null and end_date is not null
        and status <> 'cancelled'
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
end $function$
;

-- ---- Section 4: pause / resume RPCs -----------------------------------
create or replace function public.job_pause_billing(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_job record; v_cancelled int; v_flagged int;
begin
  if not (
    exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.is_admin and not p.archived)
    or exists (select 1 from public.profiles p
                 join public.user_groups ug on ug.user_id = p.user_id
                 join public.groups g on g.id = ug.group_id
                where p.user_id = auth.uid() and not p.archived and g.code = 'accounting')
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select j.* into v_job from public.jobs j where j.id = p_job_id and not j.archived;
  if v_job is null then raise exception 'job_not_found'; end if;
  if v_job.blocked_reason = 'billing_paused' then raise exception 'already_paused'; end if;
  if not v_job.billing_active then raise exception 'not_billing_active'; end if;

  -- Flag every non-archived job of this (deal, service_type) chain.
  update public.jobs j
     set is_blocked = true, blocked_reason = 'billing_paused',
         blocked_at = now(), blocked_by = auth.uid(),
         billing_active = false
   where j.deal_id = v_job.deal_id and j.service_type = v_job.service_type
     and not j.archived;
  get diagnostics v_flagged = row_count;

  -- Excuse the chain's unpaid RECURRING rows (audit-preserving).
  update public.deal_payments dp
     set status = 'cancelled'
   where dp.deal_id = v_job.deal_id
     and dp.service_type = v_job.service_type
     and dp.billing_type in ('recurring_monthly','recurring_yearly')
     and dp.status in ('pending','overdue');
  get diagnostics v_cancelled = row_count;

  return jsonb_build_object('jobs_flagged', v_flagged, 'payments_cancelled', v_cancelled);
end $function$;

create or replace function public.job_resume_billing(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_job record; v_src record; v_new_id uuid; v_next_end date; v_unflagged int;
begin
  if not (
    exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.is_admin and not p.archived)
    or exists (select 1 from public.profiles p
                 join public.user_groups ug on ug.user_id = p.user_id
                 join public.groups g on g.id = ug.group_id
                where p.user_id = auth.uid() and not p.archived and g.code = 'accounting')
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select j.* into v_job from public.jobs j where j.id = p_job_id and not j.archived;
  if v_job is null then raise exception 'job_not_found'; end if;
  if v_job.blocked_reason is distinct from 'billing_paused' then raise exception 'not_paused'; end if;

  update public.jobs j
     set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
         billing_active = true
   where j.deal_id = v_job.deal_id and j.service_type = v_job.service_type
     and not j.archived and j.blocked_reason = 'billing_paused';
  get diagnostics v_unflagged = row_count;

  -- Fresh period starting TODAY (excused semantics — no back-billing).
  -- Copy pricing from the chain's latest row (any status).
  select dp.* into v_src from public.deal_payments dp
   where dp.deal_id = v_job.deal_id and dp.service_type = v_job.service_type
     and dp.billing_type in ('recurring_monthly','recurring_yearly')
   order by dp.created_at desc limit 1;

  if v_src is not null then
    v_next_end := case when v_src.billing_type = 'recurring_yearly'
                       then (current_date + interval '1 year')::date
                       else (current_date + interval '1 month')::date end;
    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status)
      values (v_job.deal_id, v_src.service_type, v_src.service_index, v_src.billing_type,
              v_src.amount_net, v_src.vat_rate, current_date, v_next_end, 'pending')
      returning id into v_new_id;
  end if;

  return jsonb_build_object('jobs_unflagged', v_unflagged, 'new_payment_id', v_new_id,
                            'next_start', current_date, 'next_end', v_next_end);
end $function$;

revoke all on function public.job_pause_billing(uuid)  from public, anon;
revoke all on function public.job_resume_billing(uuid) from public, anon;
grant execute on function public.job_pause_billing(uuid)  to authenticated, service_role;
grant execute on function public.job_resume_billing(uuid) to authenticated, service_role;
