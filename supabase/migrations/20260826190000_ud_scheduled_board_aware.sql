-- =============================================================================
-- 2026-08-26: leads_sync_stage_on_scheduled_for becomes BOARD-AWARE.
-- Found by the UD full-test matrix: setting scheduled_for on an Under
-- Development lead teleported it to the CLASSIC board's 'scheduled' stage
-- (the stage lookup was hardcoded to board='sales'), silently removing the
-- card from the UD board. The lead's own board now resolves the target
-- ('ud_scheduled' on under_development, 'scheduled' elsewhere), and the
-- don't-drag-backwards guard uses is_terminal instead of a hardcoded code
-- list (identical outcome for the sales board: won/not_interested/dead_end).
--
-- Base body: 20260511000004_offer_followup.sql (which added the
-- pg_trigger_depth guard — the first cut of this migration was mistakenly
-- based on 20260511000003 and dropped that guard; restored same day).
-- Classic-board behavior is byte-equivalent; only leads sitting on
-- under_development change target.
-- ROLLBACK: re-apply the 20260511000004 body.
-- =============================================================================

create or replace function public.leads_sync_stage_on_scheduled_for()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target_stage_id uuid;
  cur record;
begin
  -- When invoked from within another trigger (e.g. the offers after-insert
  -- handler) the caller has already chosen the target stage — leave it alone.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.scheduled_for is null then
    return new;
  end if;
  if new.scheduled_for is not distinct from old.scheduled_for then
    return new;
  end if;

  select code, board, is_terminal into cur
    from public.pipeline_stages
   where id = new.stage_id;

  -- Don't drag terminal-state leads backwards; also no-op when already on a
  -- scheduled stage (the user is just changing the date).
  if coalesce(cur.is_terminal, false) or cur.code in ('scheduled', 'ud_scheduled') then
    return new;
  end if;

  select id into target_stage_id
    from public.pipeline_stages
   where board = coalesce(cur.board, 'sales')
     and code = case when cur.board = 'under_development' then 'ud_scheduled' else 'scheduled' end
     and archived = false
   limit 1;
  if target_stage_id is null then
    return new;
  end if;

  new.stage_id := target_stage_id;
  return new;
end $$;
