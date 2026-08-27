-- =============================================================================
-- Task 7 of the 2026-08-27 financial-correctness program: lifecycle repair so
-- no accounting stage is invisible to collections. Redefines
-- public.reconcile_deal_stage. Base migration: 20260702150150_reconcile_deal_
-- stage_respect_holds.sql (live body re-pulled 2026-08-28 and confirmed
-- byte-identical — same md5 as this file's "Pre-change" line below). Body
-- copied VERBATIM except the two edits below, each marked
-- `-- 2026-08-27 financial-correctness:`.
--
-- Spec: .superpowers/sdd/2026-08-27-financial-correctness-program/task-7-brief.md
--
-- Edit (a) — allow-list + partial_payment target logic (closes audit B1's
-- ~EUR24.5k blind spot: partial_payment deals were never touched by this
-- function, so an overdue partial balance sat forever with no escalation).
--   1. The opening allow-list gains 'partial_payment', so cur_code=
--      'partial_payment' no longer short-circuits to `return false`.
--   2. partial_payment gets its OWN v_target branch instead of falling into
--      the shared awaiting_payment/paid_in_full case statement, because that
--      shared statement is wrong for partial_payment in two ways:
--        - its `v_next_due <= current_date + 7 -> awaiting_payment` rung would
--          silently overwrite the accountant's deliberate "partial" call with
--          a stage that erases the partial-payment history/UI treatment —
--          policy for this task is that partial_payment must NEVER be moved
--          to awaiting_payment automatically.
--        - its `v_next_due is null -> paid_in_full` rung uses "no dated
--          unpaid row" as a stand-in for "nothing owed", which is false for
--          some partial rows (a non-null-balance unpaid row with no
--          start_date exists on live partial deals, e.g. deal 000048/000088/
--          000098/000168/000226/000229/005073) — using that proxy here would
--          wrongly write off a real balance as paid.
--      So the partial_payment branch computes the actual outstanding balance
--      (sum of amount_gross on non-cancelled, unpaid rows) and only exits on:
--        balance <= 0                    -> paid_in_full   (really nothing owed)
--        v_next_due <  current_date      -> on_hold        (overdue -> escalate,
--                                                            remindable via the
--                                                            existing on_hold
--                                                            pipeline)
--        otherwise (current or no dated row, balance > 0) -> partial_payment
--                                                            (stays; human's
--                                                            choice is not
--                                                            fought)
--   awaiting_payment / paid_in_full keep their existing shared branch,
--   unchanged. closed/done stay terminal and out of the allow-list by design.
--
-- Edit (b) — on_hold auto-release at zero balance (restores the release
-- dropped by 20260702150200; unsticks deal 000233, on_hold owing EUR0 for
-- 5+ weeks). The on_hold branch still blocks jobs first (unchanged), then
-- computes outstanding balance (non-cancelled pending/overdue deal_payments
-- rows). If it is <= 0, the deal moves to paid_in_full (stage looked up by
-- board='accounting_onboarding', code='paid_in_full') and jobs are unblocked
-- via the SAME inline UPDATE the function already uses on its
-- non-on_hold/paid_in_full exit path below (there is no separate
-- `unblock_deal_jobs` RPC in this schema — the existing
-- `is_blocked=false, blocked_reason=null...` UPDATE filtered on
-- blocked_reason='account_on_hold' IS the base/paid_in_full path's unblock
-- mechanism, reused verbatim here). A hold that still owes money returns
-- false exactly as before — never auto-lifted.
--
-- Pre-change md5(pg_get_functiondef) [drift-checked vs repo emission, live
-- 2026-08-28]:
--   reconcile_deal_stage   730380cc9965be05e8980c174c37b5ed
-- Post-change md5(pg_get_functiondef) [verified on prod 2026-08-28, HTTP 201]:
--   reconcile_deal_stage   6c8933fe97414d97e149844197fd21b4
-- =============================================================================

create or replace function public.reconcile_deal_stage(p_deal_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cur_code text; v_pm boolean; v_next_due date; v_target text;
  v_target_id uuid; v_moved boolean := false;
  v_balance numeric; -- 2026-08-27 financial-correctness: outstanding balance (edits a & b)
begin
  select ps.code, (d.payment_method is not null) into cur_code, v_pm
    from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where d.id = p_deal_id and not d.archived;

  if cur_code is null
     -- 2026-08-27 financial-correctness: partial_payment now escalates like
     -- awaiting_payment/paid_in_full instead of being invisible to collections.
     or cur_code not in ('awaiting_payment','on_hold','paid_in_full','partial_payment')
     or not v_pm then
    return false;
  end if;

  -- B: never auto-lift a hold. Keep jobs blocked; leave the column to the accountant.
  if cur_code = 'on_hold' then
    perform public.block_deal_jobs(p_deal_id);

    -- 2026-08-27 financial-correctness: restore the auto-release dropped by
    -- 20260702150200. A hold whose outstanding balance (non-cancelled
    -- pending/overdue deal_payments rows) has actually reached zero releases
    -- to paid_in_full and unblocks jobs; a hold that still owes money falls
    -- through to `return false` unchanged (accountant's call, as before).
    select coalesce(sum(dp.amount_gross), 0) into v_balance
      from public.deal_payments dp
     where dp.deal_id = p_deal_id
       and dp.status not in ('paid','cancelled');

    if v_balance <= 0 then
      select id into v_target_id from public.pipeline_stages
        where board='accounting_onboarding' and code='paid_in_full' limit 1;
      if v_target_id is not null then
        update public.deals set accounting_stage_id = v_target_id where id = p_deal_id;
        update public.jobs
           set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
         where deal_id = p_deal_id and is_blocked and blocked_reason='account_on_hold';
        return true;
      end if;
    end if;

    return false;
  end if;

  -- current is awaiting_payment, partial_payment, or paid_in_full: compute target from
  -- the earliest unpaid due date
  select min(dp.start_date) into v_next_due
    from public.deal_payments dp
   where dp.deal_id = p_deal_id
     and dp.status not in ('paid','cancelled')
     and dp.start_date is not null;

  if cur_code = 'partial_payment' then
    -- 2026-08-27 financial-correctness: partial_payment's ONLY automatic
    -- exits are -> on_hold (an overdue row) and -> paid_in_full (outstanding
    -- balance actually zero) — see header for why the shared branch below
    -- (v_next_due is null / <=7 days) is wrong for this stage. A partial
    -- deal with a current (non-overdue) balance stays exactly where the
    -- human put it.
    select coalesce(sum(dp.amount_gross), 0) into v_balance
      from public.deal_payments dp
     where dp.deal_id = p_deal_id
       and dp.status not in ('paid','cancelled');

    v_target := case
      when v_balance <= 0                  then 'paid_in_full'
      when v_next_due <  current_date      then 'on_hold'
      else                                       'partial_payment'
    end;
  else
    v_target := case
      when v_next_due is null              then 'paid_in_full'
      when v_next_due <  current_date      then 'on_hold'
      when v_next_due <= current_date + 7  then 'awaiting_payment'
      else                                      'paid_in_full'
    end;
  end if;

  if v_target is distinct from cur_code then
    select id into v_target_id from public.pipeline_stages
      where board='accounting_onboarding' and code=v_target limit 1;
    if v_target_id is not null then
      update public.deals set accounting_stage_id = v_target_id where id = p_deal_id;
      v_moved := true;
    end if;
  end if;

  if v_target = 'on_hold' then
    perform public.block_deal_jobs(p_deal_id);
  else
    update public.jobs
       set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
     where deal_id = p_deal_id and is_blocked and blocked_reason='account_on_hold';
  end if;

  return v_moved;
end $$;

-- ROLLBACK: restore the prior body (allow-list without 'partial_payment', no
-- partial_payment branch, on_hold early-return without the balance check)
-- from migration 20260702150150_reconcile_deal_stage_respect_holds.sql.
