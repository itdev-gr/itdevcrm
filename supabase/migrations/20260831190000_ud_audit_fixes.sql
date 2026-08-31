-- 2026-08-31: UD pipeline audit fixes — every backend finding of the full
-- bug audit (owner-approved plan, same session). Frontend fixes ship in the
-- same commit series.
--
--   1. lead_cold_ids / lead_dead_end_ids were board='sales'-only, so the
--      intake re-engage path went dead after the UD migration: a re-inquiry
--      from a parked/dead-end lead force-released a DUPLICATE lead instead of
--      merging. Both now recognize the UD board's cold/dead codes.
--   2. leads_email_automations' won branch fires on ud_won too, so UD
--      conversions get won_next_steps again (won_welcome already covered by
--      the deal-side trigger; same-key dedupe prevents doubles). The welcome
--      branch is deliberately untouched (owner: welcome stays off).
--   3. process_email_sequences' scheduled reminder / no-show / owner
--      notification blocks match ud_scheduled too (still behind their OFF
--      gates until the owner enables them).
--   4. leads_set_default_stage lands ownerless-stage inserts on
--      under_development/ud_new_lead instead of the retired classic board.
--   5. New trg_ud_leads_revive_on_owner: a chain parked because the lead had
--      no owner (ud_advance_run leaves next_event_at/current_task_id null)
--      resumes when an owner is assigned — previously frozen forever.
--   6. convert_lead_to_client writes deals.stage_id as sales/won always
--      (was the lead's own board's won → UD stage ids on deals), + backfill.
--   7. ud_process_due_runs caps each cron pass at 200 runs so a backlog can
--      never become one giant all-or-nothing transaction.
--
-- LIVE DRIFT CHECK 2026-08-31 (md5(pg_get_functiondef)); bodies below are the
-- live definitions with only the described changes:
--   lead_cold_ids            pre 88e63ad821a912c0f90f2a6f2650f5e3
--   lead_dead_end_ids        pre 59f1857073e3da436e3fe0de372bd1ca
--   leads_email_automations  pre 0efb15f370c36aa288820beda8760573
--   process_email_sequences  pre 6d071b23dad7dd67831b066655537465
--   leads_set_default_stage  pre cd78cdc3e434f4bbe95f011063b7646c
--   convert_lead_to_client   pre e2f6cab735fdf88d2b6136bc8b2194ce
--   ud_process_due_runs      pre d40695a43f64906e06f75434d6e216d5

-- 1. Cold/dead lookups learn the UD board ----------------------------------

create or replace function public.lead_cold_ids(p_ids uuid[])
returns table(id uuid)
language sql stable security definer set search_path to 'public'
as $function$
  select l.id
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where l.id = any(p_ids)
    and (
      (ps.board = 'sales'
        and ps.code in ('dead_end', 'not_interested', 'no_answer', 'constant_na'))
      or (ps.board = 'under_development'
        and ps.code in ('ud_dead_end', 'ud_not_interested', 'ud_no_answer', 'ud_not_found', 'ud_parking'))
    );
$function$;

create or replace function public.lead_dead_end_ids(p_ids uuid[])
returns table(id uuid)
language sql stable security definer set search_path to 'public'
as $function$
  select l.id
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where l.id = any(p_ids)
    and (
      (ps.board = 'sales' and ps.code in ('dead_end', 'not_interested'))
      or (ps.board = 'under_development' and ps.code in ('ud_dead_end', 'ud_not_interested'))
    );
$function$;

-- 2. won branch fires on ud_won too ----------------------------------------

CREATE OR REPLACE FUNCTION public.leads_email_automations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_code text;
  old_code text;
  seq record;
  stp record;
  v_run_id uuid;
begin
  if tg_op = 'INSERT' then
    -- Welcome only when a lead is created directly in Unique Lead (rare; only the
    -- assigned user can). Normal new/Meta leads land in New Lead → no email yet.
    if new.stage_id is not null then
      select code into new_code from public.pipeline_stages where id = new.stage_id;
      if new_code = 'unique_lead' and public.email_automation_enabled('lead_welcome') then
        perform public.enqueue_lead_email(new.id, 'lead_welcome', 'lead_welcome:' || new.id);
      end if;
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

    -- Start runs for sequences bound to the new stage.
    for seq in
      select s.id from public.email_sequences s
       where new_code = any (s.active_stage_codes)
         and not exists (
           select 1 from public.lead_sequence_runs r
            where r.lead_id = new.id and r.sequence_id = s.id and r.stopped_at is null)
    loop
      insert into public.lead_sequence_runs (lead_id, sequence_id)
      values (new.id, seq.id)
      returning id into v_run_id;

      -- Day-0 steps fire IMMEDIATELY on stage entry (2026-08-25). Same
      -- seq:<run>:<step> dedupe as the daily processor; position advanced so
      -- the cron picks up from the next step.
      for stp in
        select st.id, st.template_key, st.position
          from public.email_sequence_steps st
         where st.sequence_id = seq.id and st.enabled and st.day_offset = 0
         order by st.position
      loop
        -- Same gate as process_email_sequences: the dept_sales toggle (the
        -- sequence templates have no per-key settings rows).
        if public.email_automation_enabled('dept_sales') then
          perform public.enqueue_lead_email(
            new.id, stp.template_key, 'seq:' || v_run_id || ':' || stp.id);
          update public.lead_sequence_runs
             set last_step_position = stp.position
           where id = v_run_id;
        end if;
      end loop;
    end loop;

    -- Welcome fires on entering Unique Lead.
    if new_code = 'unique_lead' and public.email_automation_enabled('lead_welcome') then
      perform public.enqueue_lead_email(new.id, 'lead_welcome', 'lead_welcome:' || new.id);
    end if;

    if new_code in ('won', 'ud_won') then
      if public.email_automation_enabled('won_welcome') then
        perform public.enqueue_lead_email(new.id, 'won_welcome', 'auto_won_welcome:' || new.id);
      end if;
      if public.email_automation_enabled('won_next_steps') then
        perform public.enqueue_lead_email(new.id, 'won_next_steps', 'won_next_steps:' || new.id);
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- 3. Scheduled reminder / no-show learn ud_scheduled ------------------------

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

  if public.email_automation_enabled('scheduled_noshow') then
    for r in
      select l.id, l.owner_user_id from public.leads l
        join public.pipeline_stages ps on ps.id = l.stage_id and ps.code in ('scheduled', 'ud_scheduled')
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

-- 4. Default stage: UD New Lead --------------------------------------------

create or replace function public.leads_set_default_stage()
returns trigger
language plpgsql set search_path to 'public'
as $function$
begin
  if new.stage_id is null then
    select id into new.stage_id
      from public.pipeline_stages
     where board = 'under_development' and code = 'ud_new_lead'
     limit 1;
  end if;
  return new;
end;
$function$;

-- 5. Revive an owner-parked chain on assignment -----------------------------

create or replace function public.ud_leads_revive_on_owner()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_run_id uuid;
begin
  -- ud_advance_run parks an active run (next_event_at/current_task_id both
  -- null) when the lead has nobody to work the task; nothing else ever
  -- revisits it. Now that the lead has an owner, advance re-evaluates the
  -- same step and creates the task for them.
  select id into v_run_id from public.ud_cadence_runs
   where lead_id = new.id and status = 'active'
     and next_event_at is null and current_task_id is null
   limit 1;
  if v_run_id is not null then
    perform public.ud_advance_run(v_run_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_ud_leads_revive_on_owner on public.leads;
create trigger trg_ud_leads_revive_on_owner
  after update of owner_user_id on public.leads
  for each row when (old.owner_user_id is null and new.owner_user_id is not null)
  execute function public.ud_leads_revive_on_owner();

revoke execute on function public.ud_leads_revive_on_owner() from public, anon, authenticated;

-- 6. Deals always carry sales/won ------------------------------------------

CREATE OR REPLACE FUNCTION public.convert_lead_to_client(target_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l record; errors text[] := '{}'; service_count int;
  won_stage_id uuid; deal_won_stage_id uuid; acc_new_stage_id uuid; new_client_id uuid; new_deal_id uuid; full_name text;
begin
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  select * into l from public.leads where id = target_lead_id;
  if l is null then return jsonb_build_object('ok', false, 'errors', array['lead_not_found']); end if;
  if l.converted_at is not null then return jsonb_build_object('ok', false, 'errors', array['already_converted']); end if;
  if l.archived then return jsonb_build_object('ok', false, 'errors', array['lead_archived']); end if;
  if coalesce(l.estimated_one_time_value, 0) + coalesce(l.estimated_monthly_value, 0) <= 0 then
    errors := array_append(errors, 'value_required'); end if;
  service_count := coalesce(jsonb_array_length(l.services_planned), 0);
  if service_count = 0 then errors := array_append(errors, 'at_least_one_service_required'); end if;
  if l.email is null or l.email = '' then errors := array_append(errors, 'email_required'); end if;
  if (l.phone is null or l.phone = '') and (l.address is null or l.address = '') then
    errors := array_append(errors, 'phone_or_address_required'); end if;
  if l.company_name is null or trim(l.company_name) = '' then errors := array_append(errors, 'company_name_required'); end if;
  if l.payment_method is null or l.payment_method = '' then errors := array_append(errors, 'payment_method_required'); end if;
  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors); end if;

  insert into public.clients (
    name, contact_first_name, contact_last_name, email, phone, address,
    industry, country, vat_number, website, assigned_owner_id, code, start_date,
    contact_info, additional_contacts
  ) values (
    l.company_name, l.contact_first_name, l.contact_last_name, l.email, l.phone, l.address,
    l.industry, l.country, l.vat_number, l.website, null, l.code, current_date,
    l.contact_info, coalesce(l.additional_contacts, '[]'::jsonb)
  ) returning id into new_client_id;

  -- Won stage of the board the lead currently sits on (under_development keeps
  -- its card in its own Won column); sales/won when the board has none.
  select ps.id into won_stage_id
    from public.pipeline_stages ps
    join public.pipeline_stages cur on cur.id = l.stage_id
   where ps.board = cur.board and ps.terminal_outcome = 'won' and not ps.archived
   order by ps.position
   limit 1;
  if won_stage_id is null then
    select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  end if;
  -- Deals always carry the SALES board's won stage: deal reports join on it
  -- and accounting_create_deal writes the same; the LEAD still lands on its
  -- own board's won (ud_won for UD leads).
  select id into deal_won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  insert into public.deals (
    client_id, title, description, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by, code, won_by_user_id, payment_method, cash_charge_vat, sales_note,
    business_profile_url, business_profile_name
  ) values (
    new_client_id,
    coalesce(nullif(trim(l.title), ''), full_name || ' deal'),
    l.notes, null,
    l.estimated_one_time_value, l.estimated_monthly_value, l.services_planned,
    l.expected_close_date, current_date,
    coalesce(deal_won_stage_id, won_stage_id, l.stage_id), acc_new_stage_id,
    now(), auth.uid(), l.code, auth.uid(), l.payment_method, l.cash_charge_vat, l.additional_notes,
    l.business_profile_url, l.business_profile_name
  ) returning id into new_deal_id;

  update public.comments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  update public.attachments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  -- Carry captured lead emails onto the new client + deal (keep lead_id as history).
  update public.email_messages set client_id = new_client_id, deal_id = new_deal_id
    where lead_id = l.id;
  update public.leads set
      converted_at = now(), converted_client_id = new_client_id, converted_deal_id = new_deal_id,
      stage_id = coalesce(won_stage_id, stage_id), won_by_user_id = auth.uid()
    where id = l.id;

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (l.owner_user_id, 'lead_converted',
      jsonb_build_object('lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code));
  end if;

  return jsonb_build_object('ok', true, 'lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code);
end $function$;

update public.deals d
   set stage_id = (select id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1)
 where d.stage_id in (select id from public.pipeline_stages where board = 'under_development');

-- 7. Cron batch cap ---------------------------------------------------------

create or replace function public.ud_process_due_runs()
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  -- Cap each pass: a backlog drains over successive */5 runs instead of one
  -- giant all-or-nothing transaction.
  for v_id in
    select id from public.ud_cadence_runs
     where status = 'active' and next_event_at is not null and next_event_at <= now()
     order by next_event_at
     limit 200
  loop
    perform public.ud_advance_run(v_id);
  end loop;
end $function$;

-- ROLLBACK: re-emit the seven bodies from their pre-md5 sources
-- (20260623130000, 20260622200100, 20260825180000, 20260624110000,
--  20260615000006, 20260826120000, 20260826150000) and
-- drop trigger if exists trg_ud_leads_revive_on_owner on public.leads;
-- drop function if exists public.ud_leads_revive_on_owner();
