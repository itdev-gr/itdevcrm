-- Design decision B: the system never AUTO-LIFTS a hold. A deal already in On Hold
-- stays there until the accountant moves it (their move unblocks the jobs via
-- deals_hold_jobs_on_stage_change). reconcile_deal_stage now skips on_hold deals
-- (keeping their jobs blocked) and only manages awaiting_payment / paid_in_full.
-- This protects deliberate holds (e.g. blocked clients with nothing owed) from being
-- silently returned to Paid In Full + reactivated.
create or replace function public.reconcile_deal_stage(p_deal_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cur_code text; v_pm boolean; v_next_due date; v_target text;
  v_target_id uuid; v_moved boolean := false;
begin
  select ps.code, (d.payment_method is not null) into cur_code, v_pm
    from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where d.id = p_deal_id and not d.archived;

  if cur_code is null
     or cur_code not in ('awaiting_payment','on_hold','paid_in_full')
     or not v_pm then
    return false;
  end if;

  -- B: never auto-lift a hold. Keep jobs blocked; leave the column to the accountant.
  if cur_code = 'on_hold' then
    perform public.block_deal_jobs(p_deal_id);
    return false;
  end if;

  -- current is awaiting_payment or paid_in_full: compute target from the earliest unpaid due date
  select min(dp.start_date) into v_next_due
    from public.deal_payments dp
   where dp.deal_id = p_deal_id
     and dp.status not in ('paid','cancelled')
     and dp.start_date is not null;

  v_target := case
    when v_next_due is null              then 'paid_in_full'
    when v_next_due <  current_date      then 'on_hold'
    when v_next_due <= current_date + 7  then 'awaiting_payment'
    else                                      'paid_in_full'
  end;

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

-- REVERT: restore the prior body (without the on_hold skip) from migration
-- 20260702150000_reconcile_deal_stage.sql.
