-- =============================================================================
-- Auto-derive clients.status from the deal's accounting_stage transitions.
--
-- Rules:
--   accounting stage = partial_payment or paid_in_full -> client.status = 'active'
--   accounting stage = on_hold                         -> client.status = 'blocked'
--   accounting stage = done (renamed from refunded)    -> client.status = 'done'
--                                                         AND archive the deal so
--                                                         it leaves the kanban
--
-- The 'new' status is set at lead-conversion time via the column default
-- (clients.status default 'new', migration 20260503000013) — no extra wiring
-- needed there.
-- =============================================================================

-- 1. Rename the terminal stage 'refunded' -> 'done'. The kanban reads
--    display_names directly from this row, so the UI updates automatically.
update public.pipeline_stages
   set code = 'done',
       display_names = '{"en": "Done", "el": "Ολοκληρώθηκε"}'::jsonb
 where board = 'accounting_onboarding'
   and code = 'refunded';

-- 2. Trigger on deals: when accounting_stage_id changes, push the matching
--    status onto the client and (for 'done') archive the deal.
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

  -- Done = client lifecycle finished — drop the deal off the accounting
  -- kanban automatically. Existing kanban queries already filter
  -- archived = false.
  if new_code = 'done' and new.archived = false then
    new.archived := true;
    new.archived_at := now();
    new.archived_reason := coalesce(new.archived_reason, 'client_done');
  end if;

  return new;
end $$;

drop trigger if exists deals_sync_client_status on public.deals;
create trigger deals_sync_client_status
  before update on public.deals
  for each row
  when (new.accounting_stage_id is distinct from old.accounting_stage_id)
  execute function public.deals_sync_client_status_on_stage_change();
