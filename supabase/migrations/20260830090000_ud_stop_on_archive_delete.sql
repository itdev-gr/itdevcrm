-- 2026-08-30: UD cadence — no task may outlive its lead (owner sign-off
-- 2026-08-30 on the two open findings of the 2026-08-26 full regression).
--
--   B1  Archiving a lead did NOT stop its live chain: the enqueue guard
--       blocked the emails, but ud_process_due_runs kept advancing the run
--       and creating tasks for a lead nobody can see. Now archived=true stops
--       the run (status 'stopped_manual', same as a manual stop) and
--       supersedes the open task via ud_stop_live_run. Unarchiving restarts
--       NOTHING — the rep decides by moving the stage.
--
--   B2  Deleting a lead orphaned its cadence tasks: the FKs null lead_id and
--       cadence_run_id (the run cascade-deletes), so the task surfaced on the
--       GENERAL tasks board with no lead attached. Now a BEFORE DELETE trigger
--       removes the lead's cadence tasks first.
--
-- Stage moves need nothing here: trg_ud_leads_cadence_upd already stops the
-- live run on EVERY stage change, and the terminal stages (ud_not_interested /
-- ud_not_found / ud_dead_end) have no cadence bound, so nothing restarts.
--
-- No existing function is redefined — both functions and triggers are new.

-- B1 ---------------------------------------------------------------------

create or replace function public.ud_leads_stop_on_archive()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- No-op for leads without a live run (classic-board leads included).
  perform public.ud_stop_live_run(new.id, 'stopped_manual');
  return new;
end $$;

drop trigger if exists trg_ud_leads_stop_on_archive on public.leads;
create trigger trg_ud_leads_stop_on_archive
  after update of archived on public.leads
  for each row when (new.archived = true and old.archived = false)
  execute function public.ud_leads_stop_on_archive();

-- B2 ---------------------------------------------------------------------

create or replace function public.ud_leads_delete_cadence_tasks()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Completed ones go too: history of a hard-deleted lead, not worth keeping
  -- as lead-less rows in the archive. user_tasks has no DELETE guard (the
  -- terminal/outcome guards fire on UPDATE only).
  delete from public.user_tasks
   where cadence_run_id in (
     select id from public.ud_cadence_runs where lead_id = old.id
   );
  return old;
end $$;

drop trigger if exists trg_ud_leads_delete_cadence_tasks on public.leads;
create trigger trg_ud_leads_delete_cadence_tasks
  before delete on public.leads
  for each row execute function public.ud_leads_delete_cadence_tasks();

revoke execute on function public.ud_leads_stop_on_archive() from public, anon, authenticated;
revoke execute on function public.ud_leads_delete_cadence_tasks() from public, anon, authenticated;

-- ROLLBACK:
-- drop trigger if exists trg_ud_leads_stop_on_archive on public.leads;
-- drop trigger if exists trg_ud_leads_delete_cadence_tasks on public.leads;
-- drop function if exists public.ud_leads_stop_on_archive();
-- drop function if exists public.ud_leads_delete_cadence_tasks();
