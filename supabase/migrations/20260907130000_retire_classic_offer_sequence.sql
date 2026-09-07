-- =============================================================================
-- 2026-09-07 (owner): delete the last two classic offer follow-up emails.
--
--   offer_followup_day5   «{{code}} - Η προσφορά σας από την ITDEV»
--   offer_followup_day10  «{{code}} - Τελευταία υπενθύμιση για την προσφορά σας»
--
-- Same reason as offer_followup_day2 (removed in 20260907120000): the UD
-- cadence ud_offer_followup already chases the client about the offer, so this
-- chain was a second, parallel set of emails about the same thing. Their subject
-- shape gives them away — a bare «006341 - …» with no company name and no
-- customer name, against the UD shape «ITDEV | … - Γιώργος (006341)».
--
-- With these two gone the classic `offer_sent` sequence has ZERO steps left.
-- That matters, because leads_email_automations creates a run for any sequence
-- whose active_stage_codes match the new stage and does NOT check `enabled`
-- (process_email_sequences checks it only when advancing). An empty but
-- stage-matched sequence would therefore keep opening runs that can never do
-- anything. So the sequence is also switched off and unbound from its stage.
--
-- The sequence ROW is deliberately NOT deleted: lead_sequence_runs has an
-- ON DELETE CASCADE FK to it, so dropping it would take 480 historical runs
-- with it. Same principle as the 157 + N email_log rows — the record of what we
-- actually sent stays, and src/features/activity/format.ts keeps the labels so
-- those rows still render in the client activity feed.
--
-- Everything here is a data change and fully reversible; see ROLLBACK.
-- =============================================================================

-- Steps first: email_sequence_steps.template_key has an FK to email_templates.key.
delete from public.email_sequence_steps st
 using public.email_sequences s
 where st.sequence_id = s.id
   and s.key = 'offer_sent'
   and st.template_key in ('offer_followup_day5', 'offer_followup_day10');

delete from public.email_templates
 where key in ('offer_followup_day5', 'offer_followup_day10');

-- Now empty: stop it being started, and stop it being advanced.
update public.email_sequences
   set enabled = false,
       active_stage_codes = '{}',
       updated_at = now()
 where key = 'offer_sent';

-- ROLLBACK:
--   Re-seed the two templates and their steps from
--   20260610000006_email_automations_schema.sql:192-203 (templates) and
--   :288-289 (steps: sequence 'offer_sent', positions 2 and 3, day_offset 5
--   and 10), then:
--     update public.email_sequences
--        set enabled = true, active_stage_codes = array['offer_sent']
--      where key = 'offer_sent';
