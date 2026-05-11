-- =============================================================================
-- Offer-sent follow-up.
-- Each sales user has a per-user "offer_followup_days" preference (default 0).
-- When an offer is created and the creator has days > 0, the source lead:
--   - moves to the sales 'offer_sent' stage (only if currently before it)
--   - has scheduled_for set to now() + days (only if not already set)
-- Both effects happen in a single UPDATE so the leads_sync_stage_on_scheduled_for
-- trigger doesn't bounce the lead to Scheduled — it now bails when
-- pg_trigger_depth() > 1 (i.e. when invoked from inside another trigger).
-- =============================================================================

alter table public.profiles
  add column if not exists offer_followup_days int not null default 0
  check (offer_followup_days >= 0);

-- Guard the existing scheduled_for stage sync against nested invocations.
create or replace function public.leads_sync_stage_on_scheduled_for()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  scheduled_stage_id uuid;
  current_stage_code text;
begin
  -- When invoked from within another trigger (e.g. the offers after-insert
  -- handler) the caller has already chosen the target stage — leave it
  -- alone instead of forcing the lead into Scheduled.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.scheduled_for is null then
    return new;
  end if;
  if new.scheduled_for is not distinct from old.scheduled_for then
    return new;
  end if;

  select code into current_stage_code
    from public.pipeline_stages
   where id = new.stage_id;

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

-- AFTER INSERT on offers — move source lead to Offer Sent and (optionally)
-- schedule the calendar follow-up.
create or replace function public.offers_after_insert_set_offer_sent()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lead_row record;
  current_stage record;
  offer_sent record;
  followup_days int;
  new_scheduled timestamptz;
begin
  if new.lead_id is null then
    return new;
  end if;

  select * into lead_row from public.leads where id = new.lead_id;
  if lead_row is null then
    return new;
  end if;

  select id, code, position into current_stage
    from public.pipeline_stages
   where id = lead_row.stage_id;

  select id, position into offer_sent
    from public.pipeline_stages
   where board = 'sales' and code = 'offer_sent' and archived = false
   limit 1;

  -- Resolve follow-up days from the offer creator's profile. 0 (or any non-
  -- positive value) keeps the feature inactive — scheduled_for is left alone.
  select offer_followup_days into followup_days
    from public.profiles where user_id = new.created_by;

  new_scheduled := null;
  if coalesce(followup_days, 0) > 0 and lead_row.scheduled_for is null then
    new_scheduled := now() + (followup_days::text || ' days')::interval;
  end if;

  -- Apply stage + scheduled_for in one shot. The scheduled-stage sync trigger
  -- is now a no-op because pg_trigger_depth() > 1 inside this handler.
  update public.leads
     set stage_id = case
           when offer_sent.id is not null
                and current_stage.code is distinct from 'won'
                and current_stage.code is distinct from 'not_interested'
                and current_stage.code is distinct from 'dead_end'
                and (current_stage.position is null
                     or current_stage.position < offer_sent.position)
             then offer_sent.id
           else stage_id
         end,
         scheduled_for = coalesce(new_scheduled, scheduled_for)
   where id = new.lead_id;

  return new;
end $$;

drop trigger if exists offers_after_insert_set_offer_sent on public.offers;
create trigger offers_after_insert_set_offer_sent
  after insert on public.offers
  for each row execute function public.offers_after_insert_set_offer_sent();
