-- Leads created without a stage (Add-lead dialog, Meta webhook, import) landed
-- with stage_id = NULL and were invisible on the sales kanban (it groups leads
-- by stage). Default any new lead's stage to the sales 'new_lead' column.

create or replace function public.leads_set_default_stage()
returns trigger
language plpgsql
as $$
begin
  if new.stage_id is null then
    select id into new.stage_id
      from public.pipeline_stages
     where board = 'sales' and code = 'new_lead'
     limit 1;
  end if;
  return new;
end;
$$;

create trigger leads_default_stage
  before insert on public.leads
  for each row execute function public.leads_set_default_stage();

-- Backfill leads already stuck with no stage.
update public.leads
   set stage_id = (select id from public.pipeline_stages where board = 'sales' and code = 'new_lead' limit 1)
 where archived = false and stage_id is null;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop trigger if exists leads_default_stage on public.leads;
--   drop function if exists public.leads_set_default_stage();
-- ---------------------------------------------------------------------------
