-- 20260624110000_email_department_toggles.sql
-- =============================================================================
-- Department-level email switches: Sales / Accounting / Technical.
-- A client-facing automation now fires iff its DEPARTMENT toggle is on AND its
-- own per-automation switch is on. Internal/staff automations (unmapped keys)
-- keep using the existing `global` master, so their behaviour is unchanged.
-- Defaults: all three department toggles OFF (emails stay closed until the
-- admin activates a department from the admin panel).
-- =============================================================================

-- 1. Department master toggles.
insert into public.email_automation_settings (key, description, enabled) values
('dept_sales',      'Sales emails — lead welcome, follow-up cadences (no-answer / offers), scheduled-call reminders', false),
('dept_accounting', 'Accounting emails — won welcome + payment reminders', false),
('dept_technical',  'Technical emails — SEO onboarding access requests (Search Console / Business Profile)', false)
on conflict (key) do nothing;

-- 2. Map each automation/template key to a client department (null = internal).
create or replace function public.email_setting_department(setting_key text)
returns text language sql immutable as $$
  select case setting_key
    when 'lead_welcome'       then 'sales'
    when 'scheduled_confirm'  then 'sales'
    when 'scheduled_reminder' then 'sales'
    when 'scheduled_noshow'   then 'sales'
    when 'won_next_steps'     then 'sales'
    when 'won_welcome'        then 'accounting'
    when 'webseo_gsc'         then 'technical'
    when 'localseo_gbp'       then 'technical'
    else null
  end;
$$;

-- 3. Department master (client keys) or global master (internal keys), AND the
--    automation's own switch.
create or replace function public.email_automation_enabled(setting_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    case
      when public.email_setting_department(setting_key) is null then
        coalesce((select enabled from public.email_automation_settings where key = 'global'), false)
      else
        coalesce((select enabled from public.email_automation_settings
                   where key = 'dept_' || public.email_setting_department(setting_key)), false)
    end
    and coalesce((select enabled from public.email_automation_settings where key = setting_key), false);
$$;

-- 4. Sales cadence processor: gate on the Sales department toggle (was `global`).
--    Body identical to 20260610000007 except the entry gate on line ~150.
create or replace function public.process_email_sequences()
returns int
language plpgsql security definer set search_path = public as $$
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

  -- 1. Cadence steps.
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

  -- 2. Scheduled-call reminder (day before) and no-show (day after).
  if public.email_automation_enabled('scheduled_reminder') then
    for r in
      select l.id from public.leads l
        join public.pipeline_stages ps on ps.id = l.stage_id and ps.code = 'scheduled'
       where not l.archived and l.scheduled_for::date = current_date + 1
    loop
      if public.enqueue_lead_email(r.id, 'scheduled_reminder',
           'scheduled_reminder:' || r.id || ':' || to_char(current_date + 1, 'YYYYMMDD')) then
        sent := sent + 1;
      end if;
    end loop;
  end if;

  if public.email_automation_enabled('scheduled_noshow') then
    for r in
      select l.id, l.owner_user_id from public.leads l
        join public.pipeline_stages ps on ps.id = l.stage_id and ps.code = 'scheduled'
       where not l.archived and l.scheduled_for::date = current_date - 1
    loop
      if public.enqueue_lead_email(r.id, 'scheduled_noshow',
           'scheduled_noshow:' || r.id || ':' || to_char(current_date - 1, 'YYYYMMDD')) then
        sent := sent + 1;
      end if;
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

  -- 3. Constant NA for 30+ days → suggest Dead End to the owner (once).
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
end $$;

-- ROLLBACK:
--   restore email_automation_enabled + process_email_sequences from 20260610000006/07
--   (global-only gate); delete from email_automation_settings where key like 'dept_%';
--   drop function public.email_setting_department(text);
