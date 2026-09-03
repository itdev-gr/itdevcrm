-- =============================================================================
-- 2026-09-03 (owner): the no-show email becomes a BUTTON, not an automation.
--
-- «για να είμαστε σίγουροι ότι θα είναι σωστό» — a cron cannot tell a genuinely
-- missed appointment from one that was rescheduled over the phone or that just
-- ran late, and the owner's copy says «σήμερα», which a next-morning sweep can
-- never honour. The salesperson presses «Δεν απάντησε» on the lead instead.
--
-- 1. send_lead_noshow_email(lead) — the manual send, with explicit statuses so
--    the UI can say WHY nothing went out instead of failing silently.
-- 2. process_email_sequences — the automatic no-show enqueue is removed. The
--    owner notification stays (it is what prompts the decision).
--    Base body: LIVE md5 4225354df94b41624b76d27eee92ba8b, regenerated
--    programmatically so every other branch is byte-identical.
--    Post-md5 after applying: ba12e39bc75c5ba91e58df1eb449c7cf.
--
-- scheduled_confirm (trigger, immediate) and scheduled_reminder (day before)
-- are deliberately untouched: both are plain facts about a known date, so
-- there is nothing for a human to judge.
-- =============================================================================

-- 1. Manual no-show send -------------------------------------------------------
create or replace function public.send_lead_noshow_email(p_lead_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare
  l public.leads;
  v_key text;
begin
  select * into l from public.leads where id = p_lead_id;
  if l is null then return 'not_found'; end if;

  -- Client-facing mail: admins, anyone with sales edit rights, or the lead's
  -- own rep. Mirrors what leads_update already allows.
  --
  -- NULL-safety matters here, not style: with no JWT auth.uid() is NULL, so
  -- `owner_user_id = auth.uid()` is NULL, the whole OR collapses to NULL, and
  -- `if not (NULL)` never fires — the guard would silently pass. Caught by a
  -- smoke test that expected 'forbidden' and got 'automations_off'.
  if auth.uid() is null then return 'forbidden'; end if;
  if not (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or coalesce(l.owner_user_id = auth.uid(), false)
  ) then
    return 'forbidden';
  end if;

  if l.archived then return 'archived'; end if;
  if l.scheduled_for is null then return 'not_scheduled'; end if;
  if l.scheduled_for > now() then return 'not_due'; end if;
  if l.email is null or l.email = '' then return 'no_email'; end if;
  if l.email_opt_out then return 'opted_out'; end if;
  if not l.automations_enabled then return 'automations_off'; end if;

  -- One per appointment. The key carries the lead UUID so lead_email_statuses
  -- keeps matching it, and the appointment time so a reschedule may send again.
  v_key := 'scheduled_noshow:' || p_lead_id::text || ':'
           || to_char(l.scheduled_for, 'YYYYMMDDHH24MI');

  -- Transitional guard: until today the cron keyed these by date. Without this
  -- a lead the cron already emailed would get a second copy from the button.
  if exists (
    select 1 from public.email_log
     where template_key = 'scheduled_noshow'
       and dedupe_key like '%' || p_lead_id::text || '%'
       and status in ('sent','delivered','bounced','complained')
       and created_at > now() - interval '30 days'
  ) then
    return 'already_sent';
  end if;

  if public.enqueue_lead_email(p_lead_id, 'scheduled_noshow', v_key) then
    return 'sent';
  end if;
  return 'already_sent';
end $function$;

revoke execute on function public.send_lead_noshow_email(uuid) from public, anon;
grant execute on function public.send_lead_noshow_email(uuid) to authenticated;

-- 2. Drop the automatic no-show enqueue (notification kept) ---------------------
CREATE OR REPLACE FUNCTION public.process_email_sequences()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  next_step record;
  max_offset int;
  constant_na_stage uuid;
  sent int := 0;
begin
  if not coalesce((select enabled from public.email_automation_settings where key = 'dept_sales'), false) then
    return 0;
  end if;

  for r in
    select run.id as run_id, run.lead_id, run.started_on, run.last_step_position,
           s.id as sequence_id, s.key as sequence_key, s.active_stage_codes,
           ps.code as stage_code
      from public.lead_sequence_runs run
      join public.email_sequences s on s.id = run.sequence_id and s.enabled
      join public.leads l on l.id = run.lead_id and not l.archived
      left join public.pipeline_stages ps on ps.id = l.stage_id
     where run.stopped_at is null
  loop
    if r.stage_code is null or not (r.stage_code = any (r.active_stage_codes)) then
      update public.lead_sequence_runs
         set stopped_at = now(), stopped_reason = 'stage_change'
       where id = r.run_id;
      continue;
    end if;

    select * into next_step
      from public.email_sequence_steps st
     where st.sequence_id = r.sequence_id
       and st.position > r.last_step_position
       and st.enabled
     order by st.position
     limit 1;

    if next_step is null then
      select max(day_offset) into max_offset
        from public.email_sequence_steps where sequence_id = r.sequence_id;
      if r.sequence_key = 'no_answer'
         and public.email_automation_enabled('auto_move_constant_na')
         and current_date >= r.started_on + max_offset + 2 then
        select id into constant_na_stage
          from public.pipeline_stages where board = 'sales' and code = 'constant_na';
        update public.leads set stage_id = constant_na_stage where id = r.lead_id;
        update public.lead_sequence_runs
           set stopped_at = now(), stopped_reason = 'completed'
         where id = r.run_id and stopped_at is null;
      elsif r.sequence_key <> 'no_answer' then
        update public.lead_sequence_runs
           set stopped_at = now(), stopped_reason = 'completed'
         where id = r.run_id;
      end if;
      continue;
    end if;

    if current_date >= r.started_on + next_step.day_offset then
      if public.enqueue_lead_email(
           r.lead_id, next_step.template_key,
           'seq:' || r.run_id || ':' || next_step.id) then
        sent := sent + 1;
      end if;
      update public.lead_sequence_runs
         set last_step_position = next_step.position
       where id = r.run_id;
    end if;
  end loop;

  if public.email_automation_enabled('scheduled_reminder') then
    for r in
      select l.id from public.leads l
        join public.pipeline_stages ps on ps.id = l.stage_id and ps.code in ('scheduled', 'ud_scheduled')
       where not l.archived and l.scheduled_for::date = current_date + 1
    loop
      if public.enqueue_lead_email(r.id, 'scheduled_reminder',
           'scheduled_reminder:' || r.id || ':' || to_char(current_date + 1, 'YYYYMMDD')) then
        sent := sent + 1;
      end if;
    end loop;
  end if;

  -- Owner decision 2026-09-03: the no-show EMAIL is no longer sent
  -- automatically. Only the salesperson knows whether an appointment was
  -- genuinely missed, rescheduled by phone, or simply ran late — and the copy
  -- says «σήμερα», which a next-morning sweep could never honour. The email is
  -- now sent by pressing «Δεν απάντησε» on the lead (send_lead_noshow_email).
  -- What stays automatic is the owner NOTIFICATION: that is what prompts them
  -- to decide. The scheduled_noshow toggle still gates it, so an admin can
  -- silence the whole thing from /admin/email-automations.
  if public.email_automation_enabled('scheduled_noshow') then
    for r in
      select l.id, l.owner_user_id from public.leads l
        join public.pipeline_stages ps on ps.id = l.stage_id and ps.code in ('scheduled', 'ud_scheduled')
       where not l.archived and l.scheduled_for::date = current_date - 1
    loop
      if r.owner_user_id is not null then
        insert into public.notifications (user_id, type, payload)
        select r.owner_user_id, 'lead_noshow',
               jsonb_build_object('parent_type', 'lead', 'parent_id', r.id)
         where not exists (
           select 1 from public.notifications
            where type = 'lead_noshow' and payload->>'parent_id' = r.id::text
              and created_at > now() - interval '3 days');
      end if;
    end loop;
  end if;

  if public.email_automation_enabled('constant_na_suggest') then
    insert into public.notifications (user_id, type, payload)
    select l.owner_user_id, 'constant_na_suggestion',
           jsonb_build_object('parent_type', 'lead', 'parent_id', l.id,
                              'parent_label', coalesce(l.company_name, l.contact_first_name, ''))
      from public.leads l
      join public.pipeline_stages ps on ps.id = l.stage_id and ps.code = 'constant_na'
     where not l.archived
       and l.owner_user_id is not null
       and l.updated_at < now() - interval '30 days'
       and not exists (
         select 1 from public.notifications n
          where n.type = 'constant_na_suggestion' and n.payload->>'parent_id' = l.id::text);
  end if;

  return sent;
end $function$;

notify pgrst, 'reload schema';

-- ROLLBACK:
--   drop function if exists public.send_lead_noshow_email(uuid);
--   -- and re-apply the process_email_sequences body with md5
--   -- 4225354df94b41624b76d27eee92ba8b (the 20260831190000 emission).
