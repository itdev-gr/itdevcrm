-- =============================================================================
-- Keep the accounting kanban automatically in sync with payment status:
--   - Any new deal_payments row -> deal moves to Awaiting Payment.
--   - Any pending payment whose due date (end_date) has arrived -> On Hold.
-- Test rows (recurring_test_2min) and completed deals are excluded.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Trigger: AFTER INSERT on deal_payments -> move deal to Awaiting Payment
-- ---------------------------------------------------------------------------
create or replace function public.deal_payments_move_to_awaiting()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  awaiting_id uuid;
  d record;
begin
  if new.billing_type = 'recurring_test_2min' then
    return new;
  end if;

  select id into awaiting_id
    from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'awaiting_payment'
   limit 1;
  if awaiting_id is null then
    return new;
  end if;

  select id, accounting_stage_id, accounting_completed_at
    into d
    from public.deals
   where id = new.deal_id
   limit 1;
  if d is null then
    return new;
  end if;

  -- Don't override completed deals or deals not on the accounting board.
  if d.accounting_completed_at is not null then
    return new;
  end if;
  if d.accounting_stage_id is null then
    return new;
  end if;
  if d.accounting_stage_id = awaiting_id then
    return new;
  end if;

  -- Don't drag a deal back from a terminal stage (paid_in_full / refunded).
  if exists (
    select 1 from public.pipeline_stages ps
     where ps.id = d.accounting_stage_id and ps.is_terminal = true
  ) then
    return new;
  end if;

  update public.deals
     set accounting_stage_id = awaiting_id
   where id = new.deal_id;

  return new;
end $$;

drop trigger if exists deal_payments_move_to_awaiting on public.deal_payments;
create trigger deal_payments_move_to_awaiting
  after insert on public.deal_payments
  for each row execute function public.deal_payments_move_to_awaiting();

-- ---------------------------------------------------------------------------
-- RPC: move overdue deals to On Hold. Run daily by pg_cron.
-- ---------------------------------------------------------------------------
create or replace function public.move_overdue_deals_to_on_hold()
returns int
language plpgsql security definer set search_path = public as $$
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
     and d.accounting_completed_at is null
     and d.accounting_stage_id is not null
     and d.accounting_stage_id <> on_hold_id
     and not exists (
       select 1 from public.pipeline_stages ps
        where ps.id = d.accounting_stage_id and ps.is_terminal = true
     );
  get diagnostics moved = row_count;
  return moved;
end $$;

grant execute on function public.move_overdue_deals_to_on_hold() to authenticated;

-- Schedule daily at 02:05 UTC, just after the renewal cron at 02:00.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'daily_move_overdue_deals_to_on_hold') then
      perform cron.unschedule('daily_move_overdue_deals_to_on_hold');
    end if;
    perform cron.schedule(
      'daily_move_overdue_deals_to_on_hold',
      '5 2 * * *',
      $cron$ select public.move_overdue_deals_to_on_hold(); $cron$
    );
  end if;
end $$;
