-- =============================================================================
-- leads.scheduled_for — sales scheduled callback / meeting.
-- Setting this field auto-moves the lead to the sales 'scheduled' stage so
-- the kanban + the calendar on the home page stay in sync.
-- =============================================================================

alter table public.leads
  add column if not exists scheduled_for timestamptz;

create index if not exists leads_scheduled_for
  on public.leads (scheduled_for)
  where scheduled_for is not null and archived = false;

create or replace function public.leads_sync_stage_on_scheduled_for()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  scheduled_stage_id uuid;
  current_stage_code text;
begin
  if new.scheduled_for is null then
    return new;
  end if;
  if new.scheduled_for is not distinct from old.scheduled_for then
    return new;
  end if;

  select code into current_stage_code
    from public.pipeline_stages
   where id = new.stage_id;

  -- Don't drag terminal-state leads backwards; also no-op when already
  -- on the scheduled stage (the user is just changing the date).
  if current_stage_code in ('won', 'not_interested', 'dead_end', 'scheduled') then
    return new;
  end if;

  select id into scheduled_stage_id
    from public.pipeline_stages
   where board = 'sales' and code = 'scheduled' and archived = false
   limit 1;
  if scheduled_stage_id is null then
    return new;
  end if;

  new.stage_id := scheduled_stage_id;
  return new;
end $$;

drop trigger if exists leads_sync_stage_on_scheduled_for on public.leads;
create trigger leads_sync_stage_on_scheduled_for
  before update of scheduled_for on public.leads
  for each row execute function public.leads_sync_stage_on_scheduled_for();
