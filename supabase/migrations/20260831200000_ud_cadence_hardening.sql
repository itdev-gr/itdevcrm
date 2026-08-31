-- =============================================================================
-- 2026-08-31: UD cadence hardening — SQL edge-state fixes from the 2026-08-31
-- audit (owner-approved plan; frontend fixes ship in the sibling tasks of the
-- same series). Behavior is unchanged on every happy path — every change below
-- is a guard on an edge state that previously fell through silently.
--
--   G1 (ud_advance_run)                — never leapfrog an already-open task
--                                         (double cron tick / concurrent call).
--   G2 (ud_process_due_runs)           — one poisoned run must not wedge the
--                                         whole cron batch.
--   G3 (ud_start_cadence_run)          — never start/restart a chain on a
--                                         lead that is archived or converted.
--   G4 (ud_auto_pause_lead)            — never throw inside an ingestion
--                                         trigger (gmail-sync / call-router).
--   G5 — REMOVED (fix round 1): duplicate of trg_ud_leads_revive_on_owner,
--                                         already shipped by 20260831190000_ud_audit_fixes.
--   G6 (user_tasks_guard_cadence_delete) — block direct DELETE of an open
--                                         cadence task; engine-internal
--                                         cascades (lead delete) still pass.
--   G7 (ud_complete_cadence_task)      — a stale open task of the same run
--                                         (leapfrog/reopen) can no longer
--                                         stop/advance the chain out from
--                                         under the genuinely current task.
--
-- Sources copied verbatim (then only the stated guard inserted) — see the
-- ROLLBACK section for the full source-migration + line-range list.
--
-- DEVIATION from the plan's Global Constraints for G2: the plan named
-- 20260826150000:347-360 (the ORIGINAL ud_process_due_runs, no batch cap) as
-- the copy source. Since that plan was written, 20260831190000_ud_audit_fixes
-- (already committed on main, well before this migration) redefined
-- ud_process_due_runs to add `limit 200` per cron pass. Copying the plan's
-- literal body verbatim would silently REVERT that already-shipped guard.
-- This migration's G2 instead builds on the CURRENT live definition: the
-- `limit 200` cap is preserved, and the per-run exception-isolation guard is
-- added on top.
--
-- DEVIATION for G5 (fix round 1, 2026-08-31 review): 20260831190000_ud_audit_
-- fixes already ships trg_ud_leads_revive_on_owner (AFTER UPDATE OF
-- owner_user_id on public.leads), which advances a parked run when a lead
-- gains an owner — exactly what the plan's G5 guard describes. G5 is dropped
-- from this migration entirely; ud_leads_transfer_cadence_tasks is NOT
-- redefined here. No other function in this file had a live-definition
-- mismatch versus its named source (verified against supabase/migrations/*
-- before writing this file).
-- =============================================================================

-- G1. ud_advance_run — open-task + concurrency guard --------------------
-- Base: 20260828230000_ud_doc_alignment.sql:32-105 (live definition,
-- already includes the 2026-08-28 hour-granularity change), unchanged
-- except the inserted guard immediately below the run-status check.

CREATE OR REPLACE FUNCTION public.ud_advance_run(p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.ud_cadence_runs;
  s public.ud_cadence_steps;
  l public.leads;
  v_assignee uuid;
  v_due timestamptz;
  v_task_id uuid;
begin
  loop
    select * into r from public.ud_cadence_runs where id = p_run_id for update;
    if r is null or r.status <> 'active' then return; end if;

    -- Audit G1: never advance past an open task. All legitimate callers clear
    -- current_task_id before calling; a concurrent/overlapping invocation
    -- (double cron tick, manual call) would otherwise leapfrog the open task,
    -- fire the next email early and orphan the task.
    if r.current_task_id is not null then return; end if;

    select * into s from public.ud_cadence_steps
     where cadence_id = r.cadence_id and position > r.current_position and enabled
     order by position limit 1;

    if s is null then
      -- Chain fully processed (only reachable when the last step is an email;
      -- a final task's exhaustion is reported by ud_complete_cadence_task).
      update public.ud_cadence_runs
         set status = 'completed', exhausted_at = now(), next_event_at = null
       where id = p_run_id;
      return;
    end if;

    if s.kind = 'email' then
      -- 2026-08-28 doc-alignment: hours joined days in the delay arithmetic.
      v_due := r.last_event_at + make_interval(days => s.delay_days, hours => s.delay_hours);
      if v_due <= now() then
        if public.email_automation_enabled('dept_sales') then
          perform public.enqueue_lead_email(
            r.lead_id, s.template_key,
            'udcad:' || r.lead_id || ':' || s.id || ':' || r.id);
        end if;
        update public.ud_cadence_runs
           set current_position = s.position, last_event_at = now(), next_event_at = null
         where id = p_run_id;
        -- loop on to the next step
      else
        update public.ud_cadence_runs set next_event_at = v_due where id = p_run_id;
        return;
      end if;
    else
      select * into l from public.leads where id = r.lead_id;
      v_assignee := coalesce(l.owner_user_id, l.created_by);
      if v_assignee is null then
        -- No one to work the task: park (chain resumes if re-entered with an owner).
        update public.ud_cadence_runs set next_event_at = null where id = p_run_id;
        return;
      end if;
      -- 2026-08-28 doc-alignment: hours joined days in the delay arithmetic.
      v_due := greatest(now(), r.last_event_at + make_interval(days => s.delay_days, hours => s.delay_hours));
      insert into public.user_tasks
        (user_id, created_by, title, notes, due_at, importance, lead_id,
         cadence_run_id, cadence_step_id)
      values
        (v_assignee, v_assignee,
         coalesce(s.titles ->> 'el', s.titles ->> 'en', 'Cadence task'),
         'Αυτόματο task ροής Under Development — κλείνει με «Μίλησα» ή «Δεν απάντησε» από την καρτέλα του lead.',
         v_due, 'high', r.lead_id, r.id, s.id)
      returning id into v_task_id;
      update public.ud_cadence_runs
         set current_position = s.position, current_task_id = v_task_id, next_event_at = null
       where id = p_run_id;
      return;
    end if;
  end loop;
end $function$;

-- G2. ud_process_due_runs — per-run error isolation ---------------------
-- Full replacement. Builds on the live definition (20260831190000_ud_
-- audit_fixes: limit 200 per pass) — see header DEVIATION note.

create or replace function public.ud_process_due_runs()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- 20260831190000 audit_fixes: cap each pass so a backlog drains over
  -- successive */5 runs instead of one giant all-or-nothing transaction.
  for v_id in
    select id from public.ud_cadence_runs
     where status = 'active' and next_event_at is not null and next_event_at <= now()
     order by next_event_at
     limit 200
  loop
    -- Audit G2: one poisoned run must not wedge the whole batch (and, because
    -- the loop used to be one transaction, permanently block every UD email).
    begin
      perform public.ud_advance_run(v_id);
    exception when others then
      raise warning 'ud_process_due_runs: run % failed: %', v_id, sqlerrm;
    end;
  end loop;
end $$;

-- G3. ud_start_cadence_run — never start on archived/converted leads ----
-- Base: 20260826150000_ud_cadence_engine.sql:245-268 (live definition,
-- never redefined), unchanged except the inserted guard as the first
-- statement of the body.

create or replace function public.ud_start_cadence_run(p_lead_id uuid, p_stage_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  c public.ud_cadences;
  v_run_id uuid;
begin
  -- Audit G3: a stage change on an already-archived or converted lead must not
  -- restart a chain (tasks for invisible leads / chase emails to customers).
  if exists (
    select 1 from public.leads l
     where l.id = p_lead_id and (l.archived or l.converted_at is not null)
  ) then return; end if;

  perform public.ud_stop_live_run(p_lead_id, 'stopped_stage_change');

  select code into v_code from public.pipeline_stages
   where id = p_stage_id and board = 'under_development';
  if v_code is null then return; end if;

  select * into c from public.ud_cadences
   where start_stage_code = v_code and enabled;
  if c is null then return; end if;

  insert into public.ud_cadence_runs (lead_id, cadence_id)
  values (p_lead_id, c.id)
  returning id into v_run_id;

  perform public.ud_advance_run(v_run_id);
end $$;

-- G4. ud_auto_pause_lead — never throw inside ingestion triggers --------
-- Full replacement. Base: 20260826250000_ud_auto_pause.sql:24-58 (live
-- definition, never redefined) with two changes: the comment insert only
-- runs when an author exists, and the whole body is belt-and-braces
-- wrapped so a lead's sign of life can never break the pipeline recording it.

create or replace function public.ud_auto_pause_lead(p_lead_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.ud_cadence_runs;
  l public.leads;
  v_author uuid;
begin
  if not coalesce((select auto_pause_enabled from public.ud_cadence_settings limit 1), true) then
    return;
  end if;

  select * into r from public.ud_cadence_runs
   where lead_id = p_lead_id and status = 'active'
   for update;
  if r.id is null then return; end if;

  update public.ud_cadence_runs set status = 'paused' where id = r.id;

  select * into l from public.leads where id = p_lead_id;

  -- Audit G4: ownerless+creatorless leads (intake auto-release) have no valid
  -- comments.author_id (NOT NULL). Pause silently instead of blowing up the
  -- gmail-sync / call-router transaction that fired us.
  v_author := coalesce(l.owner_user_id, l.created_by);
  if v_author is not null then
    insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
    values ('lead', p_lead_id, v_author,
            '⏸ Αυτόματη παύση αλυσίδας — '
              || case p_reason when 'email' then 'ο lead απάντησε με email.'
                               else 'ο lead μάς κάλεσε.' end,
            '{}', 'cadence:auto_pause:' || r.id);
  end if;

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (l.owner_user_id, 'cadence_auto_paused',
      jsonb_build_object(
        'parent_type', 'lead', 'parent_id', p_lead_id,
        'lead_title', l.title, 'reason', p_reason));
  end if;
exception when others then
  -- A lead's sign of life must NEVER break the pipeline recording it.
  raise warning 'ud_auto_pause_lead(%): %', p_lead_id, sqlerrm;
end $$;

-- G5 removed (fix round 1, 2026-08-31): duplicate of trg_ud_leads_revive_on_owner
-- (20260831190000_ud_audit_fixes.sql:317-341), already committed AND applied to
-- prod by another session — same "advance a parked run when the lead gains an
-- owner" behavior. ud_leads_transfer_cadence_tasks is NOT redefined by this
-- migration.

-- G6. Open cadence task delete guard --------------------------------------

create or replace function public.user_tasks_guard_cadence_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Audit G6: deleting an open cadence task strands its run (active, no
  -- current task, no next event = dead). Engine-internal deletes (the
  -- lead-delete trigger from 20260830090000) arrive at trigger depth > 1 and
  -- pass; direct user deletes are refused (admins included — archive or
  -- complete the task instead; hard job/lead deletes go through their RPCs).
  if old.cadence_run_id is not null
     and old.completed_at is null
     and pg_trigger_depth() = 1 then
    raise exception 'cadence_task_delete_blocked';
  end if;
  return old;
end $$;

drop trigger if exists user_tasks_guard_cadence_delete on public.user_tasks;
create trigger user_tasks_guard_cadence_delete
  before delete on public.user_tasks
  for each row execute function public.user_tasks_guard_cadence_delete();

-- G7. ud_complete_cadence_task — stale-task guard -------------------------
-- Base: 20260826230000_ud_flow_upgrades.sql:26-117 (live 3-arg
-- definition, never redefined further), unchanged except the guard
-- inserted after the no_live_run check that follows the run's
-- `for update` load.

create or replace function public.ud_complete_cadence_task(
  p_task_id uuid,
  p_outcome text,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.user_tasks;
  r public.ud_cadence_runs;
  c public.ud_cadences;
  v_next public.ud_cadence_steps;
  v_move_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_outcome not in ('reached', 'no_answer') then
    return jsonb_build_object('ok', false, 'error', 'invalid_outcome');
  end if;

  select * into t from public.user_tasks where id = p_task_id for update;
  if t is null or t.cadence_run_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_cadence_task');
  end if;
  if t.completed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_completed');
  end if;
  if not (auth.uid() = t.user_id or public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  select * into r from public.ud_cadence_runs where id = t.cadence_run_id for update;

  -- A paused chain keeps its task open: resume first, then act.
  -- (`r.id is not null`, NOT `r is not null` — a whole-row IS NOT NULL is
  -- true only when EVERY column is non-null, and runs always carry nulls.)
  if r.id is not null and r.status = 'paused' then
    return jsonb_build_object('ok', false, 'error', 'run_paused');
  end if;

  -- Terminal-guard bypass (same GUC as resolve_task) — the outcome guard
  -- still applies and is satisfied by cadence_outcome in the same UPDATE.
  perform set_config('app.task_resolve_rpc', '1', true);

  update public.user_tasks
     set completed_at = now(), cadence_outcome = p_outcome,
         creator_resolved_at = now(), assignee_resolved_at = now()
   where id = p_task_id;

  -- The rep's one-liner rides the timeline as a plain comment (no mentions).
  if v_note is not null and t.lead_id is not null then
    insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids)
    values ('lead', t.lead_id, coalesce(auth.uid(), t.user_id),
            '☎ ' || case p_outcome when 'reached' then 'Μίλησα' else 'Δεν απάντησε' end
              || ' — ' || v_note,
            '{}');
  end if;

  if r is null or r.status <> 'active' then
    return jsonb_build_object('ok', true, 'result', 'no_live_run');
  end if;

  -- Audit G7: a stale open task of the same run (leapfrog or reopen) must not
  -- stop/advance the chain out from under the genuinely current task.
  if r.status = 'active' and r.current_task_id is not null
     and r.current_task_id <> p_task_id then
    return jsonb_build_object('ok', false, 'error', 'not_current_task');
  end if;

  update public.ud_cadence_runs
     set current_task_id = null, last_event_at = now()
   where id = r.id;

  if p_outcome = 'reached' then
    update public.ud_cadence_runs
       set status = 'stopped_reached', next_event_at = null
     where id = r.id;
    return jsonb_build_object('ok', true, 'result', 'stopped_reached');
  end if;

  select * into v_next from public.ud_cadence_steps
   where cadence_id = r.cadence_id and position > r.current_position and enabled
   order by position limit 1;

  if v_next is null then
    select * into c from public.ud_cadences where id = r.cadence_id;
    update public.ud_cadence_runs
       set status = 'completed', exhausted_at = now(), next_event_at = null
     where id = r.id;
    select id into v_move_id from public.pipeline_stages
     where board = 'under_development' and code = c.final_move_stage_code;
    return jsonb_build_object(
      'ok', true, 'result', 'exhausted',
      'final_move_stage_id', v_move_id,
      'final_move_stage_code', c.final_move_stage_code);
  end if;

  perform public.ud_advance_run(r.id);
  return jsonb_build_object('ok', true, 'result', 'advanced');
end $$;

-- ROLLBACK:
-- Drop the G6 trigger + function:
--   drop trigger if exists user_tasks_guard_cadence_delete on public.user_tasks;
--   drop function if exists public.user_tasks_guard_cadence_delete();
-- The four replaced functions (G1-G4, G7) roll back by re-running their
-- previous emissions from these exact source migrations:
--   ud_advance_run                    -> 20260828230000_ud_doc_alignment.sql:32-105
--   ud_process_due_runs               -> 20260831190000_ud_audit_fixes.sql:449-466
--                                         (the live pre-G2 definition, WITH the
--                                         limit 200 cap — NOT the plan's named
--                                         20260826150000:347-360, which predates
--                                         that cap; see header DEVIATION note)
--   ud_start_cadence_run              -> 20260826150000_ud_cadence_engine.sql:245-268
--   ud_auto_pause_lead                -> 20260826250000_ud_auto_pause.sql:24-58
--   ud_complete_cadence_task          -> 20260826230000_ud_flow_upgrades.sql:26-117
-- G5 was never redefined by this migration (removed as a duplicate of
-- trg_ud_leads_revive_on_owner, 20260831190000_ud_audit_fixes.sql:317-341) —
-- there is nothing to roll back for ud_leads_transfer_cadence_tasks here.
