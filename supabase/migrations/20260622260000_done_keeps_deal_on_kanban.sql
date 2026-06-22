-- Moving a deal to the accounting 'done' stage no longer ARCHIVES it. Previously
-- (migration 20260503000020) the trigger archived the deal on 'done' "so it leaves
-- the kanban" — but that removed it entirely and made it un-editable. Now the deal
-- stays on the kanban (Done column), still synced to client.status='done', and
-- accounting can drag it back to any stage later (which re-syncs the status).

create or replace function public.deals_sync_client_status_on_stage_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
  next_status text;
begin
  if new.accounting_stage_id is null
     or new.accounting_stage_id is not distinct from old.accounting_stage_id then
    return new;
  end if;

  select code into new_code
    from public.pipeline_stages
   where id = new.accounting_stage_id
     and board = 'accounting_onboarding';

  if new_code is null then
    return new;
  end if;

  next_status := case
    when new_code in ('partial_payment', 'paid_in_full') then 'active'
    when new_code = 'on_hold'                            then 'blocked'
    when new_code = 'done'                               then 'done'
    else null
  end;

  if next_status is not null and new.client_id is not null then
    update public.clients
       set status = next_status
     where id = new.client_id
       and status is distinct from next_status;
  end if;

  -- (Removed) previously: on 'done', set new.archived := true. Done deals now
  -- stay visible + editable on the kanban.
  return new;
end $$;

-- ROLLBACK: re-apply 20260503000020_client_status_auto_transitions.sql to restore
-- the archive-on-done behavior.
