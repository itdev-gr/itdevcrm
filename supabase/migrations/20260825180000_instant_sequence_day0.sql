-- =============================================================================
-- 2026-08-25: day-0 sequence emails fire THE MOMENT the lead enters the stage
-- (owner decision — "όταν το πάνε στην καρτέλα, όχι on timer"). Previously the
-- entry email waited for the daily 06:30 UTC process_email_sequences run (up
-- to a 24h delay). Later steps (day 2/5/10…) stay with the daily processor.
--
-- Mechanics: leads_email_automations, right after starting a sequence run,
-- immediately enqueues every enabled day_offset=0 step of that sequence with
-- the same seq:<run>:<step> dedupe the processor uses, and advances
-- last_step_position so the cron continues from the next step. (The processor
-- advances position even when enqueue dedupes, so both orders are safe.)
--
-- Redefines leads_email_automations (last full body: 20260615000008).
-- LIVE DRIFT CHECK 2026-08-25: pre/post md5(pg_get_functiondef) captured in
-- the deploy output.
-- =============================================================================

create or replace function public.leads_email_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;

-- ROLLBACK: restore the 20260615000008 body (no instant day-0 block).
