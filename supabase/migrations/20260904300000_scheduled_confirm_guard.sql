-- =============================================================================
-- 2026-09-04 INCIDENT FIX: clients were emailed «Επιβεβαίωση Ραντεβού» for
-- appointments nobody had booked.
--
-- WHAT HAPPENED (lead 007100, reported by the rep):
--   14:07:57  offer OFR-202609-0326 created
--   14:07:57  offers_after_insert_set_offer_sent moved the lead to
--             ud_offer_sent AND wrote scheduled_for = now() + 2 days
--             (profiles.offer_followup_days for that rep)
--   14:07:58  leads_email_automations saw scheduled_for change and emailed the
--             CLIENT "your appointment is confirmed for Sunday 06/09 14:07"
--
-- offer_followup_days is documented as a CALENDAR REMINDER FOR THE SALESPERSON
-- (docs/boards/sales.md:69-76; the profile hint says «follow-up στο ημερολόγιο»).
-- No spec ever contemplated emailing the client. The rest of the UI already
-- knows: CalendarPage.tsx:55-60 renders it as "Offer sent follow up" and
-- SalesKanbanCard.tsx:124-140 as "Follow-up". This email was the sole consumer
-- of scheduled_for with neither stage awareness nor a re-entrancy guard —
-- unlike its sibling leads_sync_stage_on_scheduled_for, which has guarded
-- against exactly this since 20260511000004 (comment preserved in
-- 20260826190000:26-30).
--
-- WHY IT SURFACED NOW: the path was dead since May. The trigger reads
-- profiles.offer_followup_days WHERE user_id = new.created_by, and
-- offers.created_by was never populated — all 252 rows were NULL. Commit
-- 5ab6d02 (2026-09-03) started stamping created_by, which switched the feature
-- on and exposed the missing guard with it. Zero such emails before
-- 2026-09-03 12:00; four after.
--
-- WHY THE STAGE CHECK DOES NOT BREAK REAL BOOKINGS: verified against the live
-- trigger timings. leads_sync_stage_on_scheduled_for is BEFORE UPDATE and
-- leads_email_automations is AFTER UPDATE. So when a rep books a genuine
-- appointment on a lead sitting in Offer Sent, the BEFORE trigger has already
-- advanced NEW.stage_id to scheduled/ud_scheduled (positions 50→60 on sales,
-- 30→40 on under_development, neither terminal) by the time this branch reads
-- it — the confirmation still goes out. In the offer-trigger path the BEFORE
-- sync bails on depth > 1, the stage stays Offer Sent, and the depth guard has
-- already blocked the email anyway. Both guards agree; neither is redundant.
--
-- Base body: LIVE md5 2a9b0150fac873f385cf937bcf2941cc, regenerated
-- programmatically so every other branch is byte-identical.
--
-- Containment already applied as a data change before this migration:
--   update profiles set offer_followup_days = 0 where offer_followup_days > 0;
--   (azazas=5, ekitsakis=3, dgiannakakis=3, vdimitrov=3, pgiannakopoulos=2,
--    cpostantzian=2). Re-enabling any of them is safe once this is in.
-- =============================================================================

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
  --
  -- Two guards, added 2026-09-04 after four clients were emailed an
  -- «Επιβεβαίωση Ραντεβού» for a meeting nobody had booked (lead 007100).
  -- offers_after_insert_set_offer_sent writes
  --   scheduled_for = now() + profiles.offer_followup_days
  -- as a CALENDAR REMINDER FOR THE SALESPERSON (docs/boards/sales.md:69-76).
  -- This branch could not tell that write apart from a real booking.
  --
  --   * pg_trigger_depth() — the same guard the sibling trigger
  --     leads_sync_stage_on_scheduled_for has carried since 20260511000004:
  --     a scheduled_for written from inside another trigger is not a booking.
  --   * stage check — second line of defence for a MANUAL write on a lead
  --     sitting in Offer Sent, where scheduled_for means "follow-up". That is
  --     already how CalendarPage.tsx:55-60 and SalesKanbanCard.tsx:124-140
  --     label it; only this email ever treated it as an appointment.
  if new.scheduled_for is distinct from old.scheduled_for
     and new.scheduled_for is not null
     and pg_trigger_depth() <= 1
     and public.email_automation_enabled('scheduled_confirm') then
    select code into new_code from public.pipeline_stages where id = new.stage_id;
    if coalesce(new_code, '') not in ('offer_sent', 'ud_offer_sent') then
      perform public.enqueue_lead_email(
        new.id, 'scheduled_confirm',
        'scheduled_confirm:' || new.id || ':' || to_char(new.scheduled_for, 'YYYYMMDDHH24MI'));
    end if;
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

-- Clean up the phantom appointments the dead path created. These are NOT real
-- bookings — each is exactly offer.created_at + the creator's followup_days.
-- 005792 is deliberately excluded: its scheduled_for was overwritten 90 seconds
-- later by a genuine appointment the rep booked (Mon 07/09 16:00).
update public.leads set scheduled_for = null
 where code in ('007099', '001949', '004569', '007100')
   and scheduled_for is not null;

-- ROLLBACK:
--   re-apply the leads_email_automations body with md5
--   2a9b0150fac873f385cf937bcf2941cc (the 20260831190000 emission), and
--   restore offer_followup_days per rep from the values listed above.
--   The nulled scheduled_for values are not restorable and should not be.
