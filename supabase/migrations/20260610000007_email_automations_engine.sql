-- =============================================================================
-- Email automations, part 2/2: triggers + daily processor + cron.
-- See 20260610000006 for schema/seeds and the spec discussion in chat
-- (full lead-lifecycle process approved 2026-06-10).
--
-- Rollback:
--   select cron.unschedule('process_email_sequences');
--   drop trigger trg_leads_email_automations_ins on public.leads;
--   drop trigger trg_leads_email_automations_upd on public.leads;
--   drop function public.leads_email_automations();
--   drop function public.process_email_sequences();
--   drop function public.enqueue_lead_email(uuid, text, text);
--   drop function public.lead_email_payload(public.leads);
-- =============================================================================

-- Payload shared by every lead-facing template.
create or replace function public.lead_email_payload(l public.leads)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', coalesce(nullif(trim(l.contact_first_name), ''), l.company_name, ''),
    'company', coalesce(l.company_name, ''),
    'industry', coalesce(l.industry, ''),
    'owner_name', coalesce(
      (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.user_id = l.owner_user_id),
      'η ομάδα μας'),
    'scheduled_for', coalesce(to_char(l.scheduled_for, 'DD/MM/YYYY HH24:MI'), ''),
    'lead_id', l.id,
    'unsubscribe_token', l.unsubscribe_token
  );
$$;

-- Queue one lead email iff every switch allows it. Dedupe key makes repeats
-- impossible regardless of how often this gets called.
create or replace function public.enqueue_lead_email(
  target_lead_id uuid,
  tpl_key text,
  dkey text
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  l public.leads;
begin
  select * into l from public.leads where id = target_lead_id;
  if l is null or l.archived then return false; end if;
  if l.email is null or l.email = '' then return false; end if;
  if l.email_opt_out or not l.automations_enabled then return false; end if;
  if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
    return false;
  end if;
  if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sent')) then
    return false;
  end if;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('sales', l.email, tpl_key, public.lead_email_payload(l), dkey);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Lead lifecycle trigger: welcome on insert; sequence start/stop + won emails
-- + scheduled confirmation on update.
-- ---------------------------------------------------------------------------
create or replace function public.leads_email_automations()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
  old_code text;
  seq record;
begin
  if tg_op = 'INSERT' then
    if new.source in ('manual', 'meta') and public.email_automation_enabled('lead_welcome') then
      perform public.enqueue_lead_email(new.id, 'lead_welcome', 'lead_welcome:' || new.id);
    end if;
    return new;
  end if;

  -- UPDATE: scheduled_for set/changed while the automation is on.
  if new.scheduled_for is distinct from old.scheduled_for
     and new.scheduled_for is not null
     and public.email_automation_enabled('scheduled_confirm') then
    perform public.enqueue_lead_email(
      new.id, 'scheduled_confirm',
      'scheduled_confirm:' || new.id || ':' || to_char(new.scheduled_for, 'YYYYMMDDHH24MI'));
  end if;

  if new.stage_id is distinct from old.stage_id then
    select code into new_code from public.pipeline_stages where id = new.stage_id;
    select code into old_code from public.pipeline_stages where id = old.stage_id;

    -- Stop every active run whose sequence no longer matches the stage.
    update public.lead_sequence_runs r
       set stopped_at = now(), stopped_reason = 'stage_change'
      from public.email_sequences s
     where r.sequence_id = s.id
       and r.lead_id = new.id
       and r.stopped_at is null
       and not (new_code = any (s.active_stage_codes));

    -- Start runs for sequences bound to the new stage (sequence 'enabled' is
    -- checked at send time so admins can pause/resume mid-flight).
    for seq in
      select s.id from public.email_sequences s
       where new_code = any (s.active_stage_codes)
         and not exists (
           select 1 from public.lead_sequence_runs r
            where r.lead_id = new.id and r.sequence_id = s.id and r.stopped_at is null)
    loop
      insert into public.lead_sequence_runs (lead_id, sequence_id) values (new.id, seq.id);
    end loop;

    if new_code = 'won' then
      if public.email_automation_enabled('won_welcome') then
        perform public.enqueue_lead_email(new.id, 'won_welcome', 'auto_won_welcome:' || new.id);
      end if;
      if public.email_automation_enabled('won_next_steps') then
        perform public.enqueue_lead_email(new.id, 'won_next_steps', 'won_next_steps:' || new.id);
      end if;
    end if;
  end if;

  return new;
end $$;

create trigger trg_leads_email_automations_ins
  after insert on public.leads
  for each row execute function public.leads_email_automations();

create trigger trg_leads_email_automations_upd
  after update on public.leads
  for each row execute function public.leads_email_automations();

-- ---------------------------------------------------------------------------
-- Daily processor: due cadence steps, cadence completion (auto-move to
-- Constant NA), scheduled-call reminders / no-shows, 30-day Constant NA
-- suggestion. Runs at 06:30 UTC; the outbox drain delivers within 2 minutes.
-- ---------------------------------------------------------------------------
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
  if not coalesce((select enabled from public.email_automation_settings where key = 'global'), false) then
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
      -- Cadence exhausted. For No Answer: two quiet days, then auto-move.
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

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'process_email_sequences') then
    perform cron.schedule(
      'process_email_sequences',
      '30 6 * * *',
      $cron$ select public.process_email_sequences(); $cron$
    );
  end if;
end $$;
