-- Sales cadence call tasks open on the company schedule (owner request
-- 2026-08-31): Mon-Fri 09:00-17:30 Europe/Athens. A task due past 17:30 (or
-- on a weekend / before 09:00) opens the next business day at 09:00.
-- Task steps only — email steps keep firing on their exact delays.
-- Boundaries inclusive: exactly 09:00 or 17:30 stays put.

create or replace function public.ud_business_due(p_due timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_local timestamp; -- Athens wall clock
  v_dow int;         -- ISO: 1=Mon .. 7=Sun
  v_time time;
begin
  v_local := p_due at time zone 'Europe/Athens';
  loop
    v_dow := extract(isodow from v_local)::int;
    v_time := v_local::time;
    if v_dow >= 6 then
      -- Weekend → Monday 09:00
      v_local := date_trunc('day', v_local) + make_interval(days => 8 - v_dow) + interval '9 hours';
    elsif v_time < time '09:00' then
      v_local := date_trunc('day', v_local) + interval '9 hours';
    elsif v_time > time '17:30' then
      -- Past closing → next day 09:00 (loop again: Fri 18:00 → Sat 09:00 → Mon 09:00)
      v_local := date_trunc('day', v_local) + interval '1 day 9 hours';
    else
      exit; -- inside the window
    end if;
  end loop;
  return v_local at time zone 'Europe/Athens';
end $$;

-- ud_advance_run — copied byte-identical from
-- 20260831200000_ud_cadence_hardening.sql:53-132, changing ONLY the
-- task-branch v_due line to route through the business-hours clamp above.

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
      -- Business-hours clamp (owner 2026-08-31): calls open Mon-Fri 09:00-17:30
      -- Europe/Athens; anything later rolls to the next business day 09:00.
      v_due := public.ud_business_due(
        greatest(now(), r.last_event_at + make_interval(days => s.delay_days, hours => s.delay_hours)));
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

-- ROLLBACK:
-- Re-run the ud_advance_run emission from 20260831200000_ud_cadence_hardening.sql:53-148
-- (drops the clamp), then: drop function if exists public.ud_business_due(timestamptz);
