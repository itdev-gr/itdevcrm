-- =============================================================================
-- Paid In Full becomes the living "paid-up" resting state + recurring unlock.
-- Spec: docs/superpowers/specs/2026-06-23-paid-in-full-recurring-unlock-design.md
--
--  A. paid_in_full -> non-terminal (done/closed stay terminal).
--  B. accounting_mark_paid_in_full(): drag works both ways (spawn OR unlock).
--  C. deal_payments_release_from_on_hold(): paid -> auto-return + unlock.
--  D. move_overdue_deals_to_on_hold(): also sweep onboarded recurring deals.
--  E. one-time backlog sweep of paid-up On-Hold deals (+ backup table).
-- =============================================================================

-- ── A. paid_in_full is a resting state, not a dead-end ───────────────────────
update public.pipeline_stages
   set is_terminal = false
 where board = 'accounting_onboarding' and code = 'paid_in_full';

-- Safety: done + closed MUST stay terminal so the cron sweep never touches a
-- finished client. (No-op if already true; documents the invariant.)
update public.pipeline_stages
   set is_terminal = true
 where board = 'accounting_onboarding' and code in ('done', 'closed');

-- ── B. Drag to Paid In Full, both ways ───────────────────────────────────────
-- Existing client (already has jobs, or already onboarded): move the card to
-- paid_in_full and let the deals_hold_jobs_on_stage_change trigger release the
-- account_on_hold holds. Fresh client (no jobs): delegate to complete_accounting,
-- which spawns jobs from services_planned (unchanged behavior).
create or replace function public.accounting_mark_paid_in_full(target_deal_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record;
  paid_stage_id uuid;
  has_jobs boolean;
begin
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding', 'complete_accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into d from public.deals where id = target_deal_id;
  if d is null then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;

  select exists (
    select 1 from public.jobs j where j.deal_id = d.id and not j.archived
  ) into has_jobs;

  if has_jobs or d.accounting_completed_at is not null then
    -- Established client: just move + unlock (no spawning).
    select id into paid_stage_id from public.pipeline_stages
      where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;

    update public.deals
       set accounting_stage_id    = coalesce(paid_stage_id, accounting_stage_id),
           accounting_completed_at = coalesce(accounting_completed_at, now()),
           accounting_completed_by = coalesce(accounting_completed_by, auth.uid())
     where id = d.id;

    return jsonb_build_object('ok', true, 'deal_id', d.id, 'mode', 'unlocked');
  end if;

  -- Fresh onboarding: spawn jobs the normal way (returns its own ok/errors jsonb).
  return public.complete_accounting(target_deal_id);
end $$;

grant execute on function public.accounting_mark_paid_in_full(uuid) to authenticated;

-- ── C. Money drives the board: paid -> auto-return from On Hold + unlock ──────
create or replace function public.deal_payments_release_from_on_hold()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  on_hold_id   uuid;
  paid_stage_id uuid;
  cur_stage_id uuid;
  still_owes   boolean;
begin
  -- Only act when a payment newly becomes paid.
  if new.status <> 'paid' or old.status is not distinct from 'paid' then
    return new;
  end if;

  select accounting_stage_id into cur_stage_id
    from public.deals where id = new.deal_id;
  if cur_stage_id is null then
    return new;
  end if;

  select id into on_hold_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'on_hold' limit 1;
  if on_hold_id is null or cur_stage_id <> on_hold_id then
    return new;  -- only rescue deals that are currently On Hold
  end if;

  -- Caught up only when NO past-due unpaid payment remains.
  select exists (
    select 1 from public.deal_payments dp
     where dp.deal_id = new.deal_id
       and dp.status <> 'paid'
       and dp.billing_type <> 'recurring_test_2min'
       and dp.end_date is not null
       and dp.end_date <= current_date
  ) into still_owes;
  if still_owes then
    return new;
  end if;

  select id into paid_stage_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;
  if paid_stage_id is null then
    return new;
  end if;

  update public.deals
     set accounting_stage_id = paid_stage_id
   where id = new.deal_id;
  -- deals_hold_jobs_on_stage_change releases the account_on_hold holds.
  return new;
end $$;

drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;
create trigger deal_payments_release_from_on_hold
  after update on public.deal_payments
  for each row execute function public.deal_payments_release_from_on_hold();

-- ── D. Overdue cron: also drop onboarded recurring deals to On Hold ───────────
create or replace function public.move_overdue_deals_to_on_hold()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  on_hold_id uuid;
  moved int := 0;
begin
  select id into on_hold_id
    from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'on_hold'
   limit 1;
  if on_hold_id is null then
    return 0;
  end if;

  with overdue_deals as (
    select distinct dp.deal_id
      from public.deal_payments dp
     where dp.billing_type in ('one_time','recurring_monthly','recurring_yearly')
       and dp.status = 'pending'
       and dp.end_date is not null
       and dp.end_date <= current_date
  )
  update public.deals d
     set accounting_stage_id = on_hold_id
    from overdue_deals od
   where d.id = od.deal_id
     and d.accounting_stage_id is not null
     and d.accounting_stage_id <> on_hold_id
     and not exists (
       select 1 from public.pipeline_stages ps
        where ps.id = d.accounting_stage_id
          and (ps.is_terminal = true or ps.code = 'closed')  -- never re-hold done/closed
     );
  get diagnostics moved = row_count;
  return moved;
end $function$;

-- ── E. One-time sweep: paid-up On-Hold deals -> Paid In Full + unlock ─────────
-- Backup the deals we are about to move (id + their current On-Hold stage).
create table if not exists public.deals_onhold_sweep_backup_20260623 as
select d.id as deal_id, d.accounting_stage_id as prev_stage_id, now() as backed_up_at
  from public.deals d
  join public.pipeline_stages ps
    on ps.id = d.accounting_stage_id
   and ps.board = 'accounting_onboarding' and ps.code = 'on_hold'
 where not exists (
   select 1 from public.deal_payments dp
    where dp.deal_id = d.id
      and dp.status <> 'paid'
      and dp.billing_type <> 'recurring_test_2min'
      and dp.end_date is not null
      and dp.end_date <= current_date
 );

-- Move them (fires deals_hold_jobs_on_stage_change -> releases account_on_hold).
update public.deals d
   set accounting_stage_id = (
        select id from public.pipeline_stages
         where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1)
 where d.id in (select deal_id from public.deals_onhold_sweep_backup_20260623);

-- Belt-and-braces: ensure those deals' SEO jobs are unlocked.
update public.jobs j
   set is_blocked = false, blocked_reason = null, blocked_at = null
 where j.blocked_reason = 'account_on_hold'
   and j.deal_id in (select deal_id from public.deals_onhold_sweep_backup_20260623);

-- =============================================================================
-- CHANGES / REVERT
--   A. pipeline_stages('paid_in_full').is_terminal  true -> false
--   B. + function accounting_mark_paid_in_full(uuid)
--   C. + function/trigger deal_payments_release_from_on_hold
--   D. move_overdue_deals_to_on_hold() : dropped `accounting_completed_at is null`
--   E. one-time sweep + deals_onhold_sweep_backup_20260623
--
-- ROLLBACK:
--   update public.pipeline_stages set is_terminal = true
--     where board='accounting_onboarding' and code='paid_in_full';
--   drop function if exists public.accounting_mark_paid_in_full(uuid);
--   drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;
--   drop function if exists public.deal_payments_release_from_on_hold();
--   -- restore move_overdue_deals_to_on_hold() body from migration 20260619110000
--   --   (re-add the `and d.accounting_completed_at is null` clause);
--   -- re-hold swept deals: move each back to its prev_stage_id from
--   --   deals_onhold_sweep_backup_20260623 (the hold trigger re-blocks SEO jobs).
-- =============================================================================
