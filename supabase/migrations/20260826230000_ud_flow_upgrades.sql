-- =============================================================================
-- 2026-08-26: Under Development flow upgrades (owner: «όλα κάντα») —
--
-- 1) ud_complete_cadence_task gains an optional NOTE: one line typed with the
--    outcome lands on the lead timeline as a comment (☎ prefix, no mentions).
--    Also: completing a task while the chain is PAUSED is refused
--    ('run_paused') so a frozen chain can never silently lose its task.
--    The 2-arg signature is dropped (PostgREST would see an ambiguous overload).
-- 2) ud_snooze_cadence_task: the rep (or an admin) pushes an open chain task's
--    due date («πάρε με Πέμπτη») without burning a step.
-- 3) ud_set_run_paused: Pause / Resume of a lead's live chain (owner or
--    admin). Paused runs are skipped by the cron and refuse task completion;
--    resume simply reactivates — an email step that came due during the pause
--    fires on the next cron tick.
-- 4) Offers: when an offer for an Under Development lead is marked SENT
--    (sent_at set), the lead auto-moves to ud_offer_sent and the follow-up
--    chain starts by itself. UD board only, never from a terminal stage.
--
-- ROLLBACK: see block at the end.
-- =============================================================================

-- 1. complete-with-note (+ paused guard) --------------------------------------

drop function if exists public.ud_complete_cadence_task(uuid, text);

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

grant execute on function public.ud_complete_cadence_task(uuid, text, text) to authenticated;

-- 2. Snooze -------------------------------------------------------------------

create or replace function public.ud_snooze_cadence_task(p_task_id uuid, p_due timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.user_tasks;
begin
  select * into t from public.user_tasks where id = p_task_id for update;
  if t is null or t.cadence_run_id is null or t.completed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'not_an_open_cadence_task');
  end if;
  if not (auth.uid() = t.user_id or public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;
  if p_due is null or p_due < now() - interval '1 hour' then
    return jsonb_build_object('ok', false, 'error', 'invalid_due');
  end if;

  update public.user_tasks
     set due_at = p_due,
         -- A fresh deadline deserves fresh overdue escalation.
         cadence_overdue_notified_at = null,
         cadence_overdue_admin_notified_at = null
   where id = p_task_id;
  return jsonb_build_object('ok', true, 'due_at', p_due);
end $$;

grant execute on function public.ud_snooze_cadence_task(uuid, timestamptz) to authenticated;

-- 3. Pause / Resume -----------------------------------------------------------

create or replace function public.ud_set_run_paused(p_lead_id uuid, p_paused boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.leads;
  r public.ud_cadence_runs;
begin
  select * into l from public.leads where id = p_lead_id;
  if l is null then return jsonb_build_object('ok', false, 'error', 'lead_not_found'); end if;
  if not (auth.uid() = l.owner_user_id or public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  select * into r from public.ud_cadence_runs
   where lead_id = p_lead_id and status in ('active', 'paused')
   for update;
  if r is null then return jsonb_build_object('ok', false, 'error', 'no_live_run'); end if;

  if p_paused and r.status = 'active' then
    update public.ud_cadence_runs set status = 'paused' where id = r.id;
  elsif not p_paused and r.status = 'paused' then
    update public.ud_cadence_runs set status = 'active' where id = r.id;
  end if;
  return jsonb_build_object('ok', true, 'status', case when p_paused then 'paused' else 'active' end);
end $$;

grant execute on function public.ud_set_run_paused(uuid, boolean) to authenticated;

-- 4. Offer created → the lead's OWN board's Offer Sent stage ------------------
-- The platform already had this automation (offers_after_insert_set_offer_sent,
-- 20260511000004) but hardcoded to board='sales' — creating an offer for an
-- Under Development lead teleported it onto the classic board. Same body,
-- board-aware target + is_terminal guard (identical classic outcome).

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

  select id, code, board, position, is_terminal into current_stage
    from public.pipeline_stages
   where id = lead_row.stage_id;

  -- The lead's own board decides which Offer Sent it moves to.
  select id, position into offer_sent
    from public.pipeline_stages
   where board = coalesce(current_stage.board, 'sales')
     and code = case when current_stage.board = 'under_development'
                     then 'ud_offer_sent' else 'offer_sent' end
     and archived = false
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
  -- is a no-op here because pg_trigger_depth() > 1 inside this handler.
  update public.leads
     set stage_id = case
           when offer_sent.id is not null
                and not coalesce(current_stage.is_terminal, false)
                and (current_stage.position is null
                     or current_stage.position < offer_sent.position)
             then offer_sent.id
           else stage_id
         end,
         scheduled_for = coalesce(new_scheduled, scheduled_for)
   where id = new.lead_id;

  return new;
end $$;

-- The first cut of this migration shipped a duplicate sent_at-based trigger;
-- the board-aware rewrite above supersedes it.
drop trigger if exists trg_ud_offers_auto_stage on public.offers;
drop function if exists public.ud_offers_auto_stage();

-- ROLLBACK:
-- (restore offers_after_insert_set_offer_sent from 20260511000004)
-- drop function if exists public.ud_set_run_paused(uuid, boolean);
-- drop function if exists public.ud_snooze_cadence_task(uuid, timestamptz);
-- drop function if exists public.ud_complete_cadence_task(uuid, text, text);
-- (restore the 2-arg ud_complete_cadence_task from 20260826150000 + the GUC
--  patch in the deploy notes)
