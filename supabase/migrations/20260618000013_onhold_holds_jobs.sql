-- When a deal enters accounting "On Hold", hold its jobs (is_blocked +
-- blocked_reason='account_on_hold'); when it leaves On Hold, release exactly
-- those holds. Fires for both the manual board move and the overdue cron.
create or replace function public.deals_hold_jobs_on_stage_change()
returns trigger
language plpgsql
as $$
declare
  new_code text;
begin
  if new.accounting_stage_id is null
     or new.accounting_stage_id is not distinct from old.accounting_stage_id then
    return new;
  end if;

  select code into new_code
    from public.pipeline_stages
   where id = new.accounting_stage_id and board = 'accounting_onboarding';

  if new_code = 'on_hold' then
    update public.jobs j
       set is_blocked = true,
           blocked_reason = 'account_on_hold',
           blocked_at = now()
      from public.pipeline_stages s
     where j.deal_id = new.id
       and not j.archived
       and not j.is_blocked
       and s.id = j.stage_id
       and not s.is_terminal;
  elsif new_code is not null then
    update public.jobs
       set is_blocked = false, blocked_reason = null, blocked_at = null
     where deal_id = new.id
       and is_blocked = true
       and blocked_reason = 'account_on_hold';
  end if;

  return new;
end $$;

drop trigger if exists deals_hold_jobs_on_hold on public.deals;
create trigger deals_hold_jobs_on_hold
  after update on public.deals
  for each row
  when (new.accounting_stage_id is distinct from old.accounting_stage_id)
  execute function public.deals_hold_jobs_on_stage_change();

-- One-time backfill: deals already parked in On Hold whose jobs were never held.
update public.jobs j
   set is_blocked = true, blocked_reason = 'account_on_hold', blocked_at = now()
  from public.deals d
  join public.pipeline_stages acs on acs.id = d.accounting_stage_id,
       public.pipeline_stages s
 where j.deal_id = d.id
   and s.id = j.stage_id
   and acs.code = 'on_hold' and not d.archived
   and not j.archived and not j.is_blocked and not s.is_terminal;

-- ROLLBACK:
-- drop trigger if exists deals_hold_jobs_on_hold on public.deals;
-- drop function if exists public.deals_hold_jobs_on_stage_change();
-- update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null where blocked_reason='account_on_hold';
