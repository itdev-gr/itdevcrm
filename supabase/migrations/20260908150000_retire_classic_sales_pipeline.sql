-- =============================================================================
-- 20260908150000_retire_classic_sales_pipeline.sql
-- Owner (2026-09-08): το κλασικό sales pipeline αποσύρεται — το Under
-- Development board ΕΙΝΑΙ πλέον το sales pipeline. Full audit προηγήθηκε
-- (frontend + DB + prod): 0 ενεργά leads σε όλα τα sales stages από 29/7· όλα
-- τα νέα leads προσγειώνονται στο UD από τις 31/8 (20260831120000/190000).
--
-- Τι κάνει:
--   1. Αρχειοθετεί τα 10 sales stages ΕΚΤΟΣ του won. Το sales/won μένει
--      ενεργό ΓΙΑ ΠΑΝΤΑ: κάθε deal (621 σήμερα, +8/14μέρες) το κουβαλάει στο
--      deals.stage_id — convert_lead_to_client και accounting_create_deal το
--      γράφουν ρητά (20260831210000:92), και τα deal reports κάνουν join εκεί.
--      ΑΡΧΕΙΟΘΕΤΗΣΗ, όχι DELETE: όλα τα FKs προς pipeline_stages είναι
--      restrict (194 αρχειοθετημένα leads + 2 deals δείχνουν στα rows), και το
--      activity log κρατάει stage UUIDs που πρέπει να συνεχίσουν να
--      resolve-άρουν σε όνομα — ίδιο pattern με κάθε προηγούμενο stage
--      retirement (20260615000001, 20260630010000, 20260703060000).
--   2. Σβήνει ΟΛΑ τα classic-pipeline emails (εντολή owner: «δεν θέλω να
--      υπάρχουν γενικά μέσα στο CRM»), με το ίδιο pattern που αποσύρθηκε η
--      offer_sent στις 7/9 (20260907130000): διαγραφή steps + templates,
--      απενεργοποίηση + ξεκρέμασμα των sequences, στοπ στα ανοιχτά runs. Τα
--      sequence ROWS και τα ιστορικά runs/email_log ΜΕΝΟΥΝ (τι στείλαμε σε
--      ποιον = λογιστικό ίχνος· το activity format.ts κρατάει ήδη τα labels
--      των σβησμένων templates ώστε το feed να συνεχίσει να τα δείχνει).
--   3. Null-guard στο auto_move_constant_na branch του process_email_sequences
--      ώστε ΠΟΤΕ μελλοντική απουσία του stage να μη γράψει stage_id = NULL.
--   4. Απενεργοποιεί το lead_welcome one-shot (κλειδωμένο στο classic
--      unique_lead stage που αρχειοθετείται — δεν μπορεί να ξαναπυροδοτηθεί·
--      το toggle μένει ορατό στο /admin/email-automations αν ξαναχρειαστεί).
--   5. Πετάει τα shuffle RPCs (apply_lead_shuffle, lead_shuffle_pool) — μόνος
--      καταναλωτής ήταν η σελίδα /sales/kanban που αφαιρείται στο ίδιο ship.
-- =============================================================================

-- --- 1. Αρχειοθέτηση των classic stages (πλην won) ---------------------------
update public.pipeline_stages
   set archived = true
 where board = 'sales'
   and code <> 'won'
   and not archived;

-- --- 2. Διαγραφή των classic sales emails ------------------------------------
-- Steps πρώτα (FK email_sequence_steps.template_key -> email_templates.key).
delete from public.email_sequence_steps st
 using public.email_sequences s
 where st.sequence_id = s.id
   and s.key in ('no_answer', 'reengage');

delete from public.email_templates
 where key in ('noanswer_day0', 'noanswer_day2', 'noanswer_day5',
               'noanswer_day10', 'reengage_90d');

-- Άδειες πλέον: ούτε νέα runs (active_stage_codes = {}), ούτε προώθηση
-- (enabled = false — το process_email_sequences κάνει join σε s.enabled).
update public.email_sequences
   set enabled = false,
       active_stage_codes = '{}',
       updated_at = now()
 where key in ('no_answer', 'reengage');

-- Τα ανοιχτά runs των classic sequences (και της ήδη αποσυρμένης offer_sent)
-- κλείνουν καθαρά αντί να μείνουν για πάντα «live» αλλά αόρατα στον loop.
update public.lead_sequence_runs run
   set stopped_at = now(), stopped_reason = 'sequence_retired'
  from public.email_sequences s
 where s.id = run.sequence_id
   and s.key in ('no_answer', 'reengage', 'offer_sent')
   and run.stopped_at is null;

-- --- 3. process_email_sequences: null-guard στο constant_na auto-move --------
-- Σώμα αυτούσιο από το 20260903180000 με ΜΙΑ αλλαγή: το update του lead
-- τυλίγεται σε `if constant_na_stage is not null` — αλλιώς μια μελλοντική
-- διαγραφή του stage θα έγραφε stage_id = NULL και το lead θα εξαφανιζόταν
-- από κάθε board. Το run κλείνει «completed» ούτως ή άλλως.
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
        if constant_na_stage is not null then
          update public.leads set stage_id = constant_na_stage where id = r.lead_id;
        end if;
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

-- --- 4. lead_welcome: κλειδωμένο στο classic unique_lead — σβηστό ------------
update public.email_automation_settings
   set enabled = false
 where key = 'lead_welcome';

-- --- 5. Shuffle RPCs: πεθαίνουν μαζί με τη σελίδα ----------------------------
drop function if exists public.apply_lead_shuffle(text, jsonb);
drop function if exists public.lead_shuffle_pool();

notify pgrst, 'reload schema';

-- ROLLBACK:
--   update public.pipeline_stages set archived = false where board='sales' and code <> 'won';
--   Re-seed templates noanswer_day0/2/5/10 + reengage_90d και τα steps τους από
--   20260610000006_email_automations_schema.sql (:156-266 templates, :283-290
--   steps), μετά:
--     update public.email_sequences set enabled = true,
--       active_stage_codes = case key when 'no_answer' then array['no_answer']
--                                     else array['not_interested','dead_end'] end
--      where key in ('no_answer','reengage');
--   update public.email_automation_settings set enabled = true where key='lead_welcome';
--   Ξανατρέξε το process_email_sequences body του 20260903180000 (χωρίs guard)
--   και τα apply_lead_shuffle / lead_shuffle_pool από το 20260623120000.
