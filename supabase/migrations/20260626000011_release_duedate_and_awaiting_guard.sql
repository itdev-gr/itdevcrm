-- Payment-driven block lifecycle (2/4): re-base release on the DUE date (start_date),
-- and stop the move-to-awaiting trigger from un-holding overdue deals.

-- Release: when a payment is marked paid and the On-Hold/Partial deal has no unpaid payment
-- still past its DUE date (start_date), advance to paid_in_full (fires the hold trigger's
-- release). Only when payment_method is set, so we never trip guard_payment_method_before_stage_move.
create or replace function public.deal_payments_release_from_on_hold()
returns trigger language plpgsql security definer set search_path = public as $$
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
              where dp.deal_id = new.deal_id and dp.status <> 'paid'
                and dp.start_date is not null and dp.start_date <= current_date) then
    return new;  -- still owes a due payment
  end if;

  select id into paid_stage_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;
  if paid_stage_id is null then return new; end if;
  update public.deals set accounting_stage_id = paid_stage_id where id = new.deal_id;
  return new;
end $$;

-- Move-to-awaiting: never drag an On-Hold or Partial-Payment deal back to Awaiting when a new
-- recurring period is generated (that would silently un-hold/unblock an overdue client).
create or replace function public.deal_payments_move_to_awaiting()
returns trigger language plpgsql security definer set search_path = public as $$
declare awaiting_id uuid; d record; current_stage_code text;
begin
  if new.billing_type = 'recurring_test_2min' then return new; end if;
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
  -- Leave brand-new deals in New; never pull a blocked (on_hold/partial) deal back to Awaiting.
  if current_stage_code in ('new','on_hold','partial_payment') then return new; end if;
  if exists (select 1 from public.pipeline_stages ps where ps.id = d.accounting_stage_id and ps.is_terminal) then
    return new;
  end if;

  update public.deals set accounting_stage_id = awaiting_id where id = new.deal_id;
  return new;
end $$;

-- ROLLBACK: restore both functions from their prior definitions
--   (deal_payments_release_from_on_hold: 20260623140000 end_date version;
--    deal_payments_move_to_awaiting: prior version without the on_hold/partial guard).
